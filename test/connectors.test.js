// Generic connectors: parsers, write-back, recurrence, registry.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const markdown = require('../connectors/markdown');
const todotxt = require('../connectors/todotxt');
const ics = require('../connectors/ics');
const { loadConnectors, resolveConfig } = require('../connectors');
const { todayLocal, localDate } = require('../connectors/util');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-conn-'));
const plusDays = n => localDate(new Date(Date.now() + n * 86400000));

// ---- markdown ----
test('markdown parses open tasks and the common due-date conventions', () => {
  const md = [
    '# List',
    '- [ ] Call the plumber 📅 2026-10-03',
    '- [x] Already done',
    '* [ ] Send **draft** to [[Pat|Pat Lee]] due:2026-10-05',
    '1. [ ] Numbered [due:: 2026-10-06]',
    '- [ ] TaskPaper style @due(2026-10-07)',
    '- [ ] No date ⏫',
    'Not a task',
  ].join('\n');
  const t = markdown.parseMarkdownTasks(md);
  assert.deepStrictEqual(t.map(x => [x.text, x.deadline]), [
    ['Call the plumber', '2026-10-03'],
    ['Send draft to Pat Lee', '2026-10-05'],
    ['Numbered', '2026-10-06'],
    ['TaskPaper style', '2026-10-07'],
    ['No date', null],
  ]);
});

test('markdown ingest filters by window and ✓ ticks the exact line', async () => {
  const dir = tmp();
  const file = path.join(dir, 'todo.md');
  fs.writeFileSync(file, `- [ ] Soon 📅 ${plusDays(1)}\n- [ ] Far 📅 ${plusDays(40)}\n- [ ] Undated\n- [ ] Late 📅 ${plusDays(-2)}\n`);
  const r = await markdown.ingest(resolveConfig(markdown, { files: [file] }));
  assert.deepStrictEqual(r.notes.map(n => n.text).sort(), ['Late', 'Soon', 'Undated']);
  const soon = r.notes.find(n => n.text === 'Soon');
  await markdown.done(soon);
  assert.ok(fs.readFileSync(file, 'utf8').startsWith(`- [x] Soon 📅 ${plusDays(1)}\n`));
  // The same note again no longer matches an open line.
  await assert.rejects(markdown.done(soon));
});

test('markdown reports missing files without dropping the rest', async () => {
  const dir = tmp();
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, '- [ ] One\n');
  const r = await markdown.ingest(resolveConfig(markdown, { files: [file, path.join(dir, 'gone.md')] }));
  assert.strictEqual(r.notes.length, 1);
  assert.match(r.error, /gone\.md/);
});

test('markdown keeps CRLF files CRLF', async () => {
  const dir = tmp();
  const file = path.join(dir, 'w.md');
  fs.writeFileSync(file, '- [ ] Win task\r\n- [ ] Other\r\n');
  const r = await markdown.ingest(resolveConfig(markdown, { files: [file] }));
  await markdown.done(r.notes[0]);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '- [x] Win task\r\n- [ ] Other\r\n');
});

// ---- todo.txt ----
test('todo.txt parses priority, creation date and due, skips completed', () => {
  assert.deepStrictEqual(todotxt.parseTodoLine('(A) 2026-09-01 Pay rent +home due:2026-10-01'),
    { raw: '(A) 2026-09-01 Pay rent +home due:2026-10-01', priority: 'A', deadline: '2026-10-01', text: '(A) Pay rent +home' });
  assert.strictEqual(todotxt.parseTodoLine('x 2026-09-30 done thing'), null);
  assert.strictEqual(todotxt.parseTodoLine('   '), null);
});

test('todo.txt ✓ completes the line per spec, keeping priority as pri:', async () => {
  const dir = tmp();
  const file = path.join(dir, 'todo.txt');
  fs.writeFileSync(file, `(B) Water plants due:${todayLocal()}\nCall mom\n`);
  const r = await todotxt.ingest(resolveConfig(todotxt, { file }));
  assert.strictEqual(r.notes.length, 2);
  await todotxt.done(r.notes.find(n => n.text.includes('Water')));
  assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n')[0], `x ${todayLocal()} Water plants due:${todayLocal()} pri:B`);
});

// ---- ics ----
const cal = events => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const ymd = d => d.replace(/-/g, '');

test('ics: single timed event today in UTC, converted to local', () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0);
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const text = cal([['BEGIN:VEVENT', 'UID:a', `DTSTART:${z(start)}`, `DTEND:${z(new Date(start.getTime() + 3600e3))}`,
    'SUMMARY:Board call', 'LOCATION:Zoom', 'END:VEVENT']]);
  const occ = ics.occurrencesToday(text, now);
  assert.strictEqual(occ.length, 1);
  assert.strictEqual(occ[0].startMs, start.getTime());
  assert.strictEqual(occ[0].endMs - occ[0].startMs, 3600e3);
  assert.strictEqual(occ[0].location, 'Zoom');
});

test('ics: weekly rule with BYDAY hits only listed weekdays, honors EXDATE and overrides', () => {
  const today = todayLocal();
  const dows = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const todayCode = dows[new Date(today + 'T12:00:00').getDay()];
  const otherCode = dows[(new Date(today + 'T12:00:00').getDay() + 3) % 7];
  const startDate = ymd(plusDays(-28));
  const ev = (uid, byday, extra = []) => ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${startDate}T090000`, `DTEND:${startDate}T093000`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday}`, 'SUMMARY:' + uid, ...extra, 'END:VEVENT'];
  const now = new Date(today + 'T06:00:00');
  const base = ics.occurrencesToday(cal([ev('hit', `${todayCode},${otherCode}`), ev('miss', otherCode)]), now);
  assert.deepStrictEqual(base.map(o => o.title), ['hit']);
  const ex = ics.occurrencesToday(cal([ev('hit', todayCode, [`EXDATE:${ymd(today)}T090000`])]), now);
  assert.strictEqual(ex.length, 0);
  // A moved instance: master skipped today, override shows at its new time.
  const moved = cal([ev('m', todayCode), ['BEGIN:VEVENT', 'UID:m', `RECURRENCE-ID:${ymd(today)}T090000`,
    `DTSTART:${ymd(today)}T140000`, `DTEND:${ymd(today)}T143000`, 'SUMMARY:m moved', 'END:VEVENT']]);
  const mo = ics.occurrencesToday(moved, now);
  assert.deepStrictEqual(mo.map(o => o.title), ['m moved']);
  assert.strictEqual(new Date(mo[0].startMs).getHours(), 14);
});

test('ics: COUNT and UNTIL stop a series; INTERVAL skips', () => {
  const today = todayLocal();
  const now = new Date(today + 'T06:00:00');
  const daily = (rule, startOffset) => cal([['BEGIN:VEVENT', 'UID:d', `DTSTART:${ymd(plusDays(startOffset))}T100000`,
    `DTEND:${ymd(plusDays(startOffset))}T103000`, `RRULE:${rule}`, 'SUMMARY:d', 'END:VEVENT']]);
  assert.strictEqual(ics.occurrencesToday(daily('FREQ=DAILY;COUNT=3', -5), now).length, 0);
  assert.strictEqual(ics.occurrencesToday(daily('FREQ=DAILY;COUNT=6', -5), now).length, 1);
  assert.strictEqual(ics.occurrencesToday(daily(`FREQ=DAILY;UNTIL=${ymd(plusDays(-1))}T235959Z`, -5), now).length, 0);
  assert.strictEqual(ics.occurrencesToday(daily('FREQ=DAILY;INTERVAL=2', -4), now).length, 1);
  assert.strictEqual(ics.occurrencesToday(daily('FREQ=DAILY;INTERVAL=2', -3), now).length, 0);
});

test('ics: monthly ordinal weekday and last-weekday rules', () => {
  const start = { y: 2026, mo: 1, d: 13, h: 9, mi: 0, s: 0, tz: null };
  // 2nd Tuesday: Oct 13 2026 is a Tuesday and the second one in October.
  assert.ok(ics.ruleHitsDay({ FREQ: 'MONTHLY', BYDAY: '2TU' }, start, 2026, 10, 13));
  assert.ok(!ics.ruleHitsDay({ FREQ: 'MONTHLY', BYDAY: '2TU' }, start, 2026, 10, 6));
  // Last Friday of October 2026 is Oct 30.
  assert.ok(ics.ruleHitsDay({ FREQ: 'MONTHLY', BYDAY: '-1FR' }, start, 2026, 10, 30));
  assert.ok(!ics.ruleHitsDay({ FREQ: 'MONTHLY', BYDAY: '-1FR' }, start, 2026, 10, 23));
  // Last day of month via BYMONTHDAY=-1.
  assert.ok(ics.ruleHitsDay({ FREQ: 'MONTHLY', BYMONTHDAY: '-1' }, start, 2026, 2, 28));
});

test('ics: all-day and TZID events, cancelled skipped', () => {
  const today = todayLocal();
  const now = new Date(today + 'T06:00:00');
  const text = cal([
    ['BEGIN:VEVENT', 'UID:ad', `DTSTART;VALUE=DATE:${ymd(today)}`, `DTEND;VALUE=DATE:${ymd(plusDays(1))}`, 'SUMMARY:Holiday', 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:tz', `DTSTART;TZID=Pacific Standard Time:${ymd(today)}T120000`, `DTEND;TZID=Pacific Standard Time:${ymd(today)}T130000`, 'SUMMARY:Lunch', 'END:VEVENT'],
    ['BEGIN:VEVENT', 'UID:c', `DTSTART:${ymd(today)}T120000`, 'STATUS:CANCELLED', 'SUMMARY:Gone', 'END:VEVENT'],
  ]);
  const occ = ics.occurrencesToday(text, now);
  const titles = occ.map(o => o.title);
  assert.ok(titles.includes('Holiday'));
  assert.ok(!titles.includes('Gone'));
  const lunch = occ.find(o => o.title === 'Lunch');
  if (lunch) {
    // Noon Pacific, whatever this machine's zone is.
    const pt = new Date(lunch.startMs).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false });
    assert.strictEqual(pt, '12');
  }
});

// ---- registry ----
test('registry loads built-ins, hides other-platform connectors, loads a custom folder', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'mine.js'),
    "module.exports = { key: 'mine', label: 'Mine', order: 5, ingest: async () => ({ notes: [] }) };");
  fs.writeFileSync(path.join(dir, 'broken.js'), 'throw new Error("boom")');
  const win = loadConnectors({ extraDirs: [dir], platform: 'win32' });
  const keys = win.list.map(c => c.key);
  assert.ok(keys.includes('mine'));
  assert.ok(keys.includes('ics') && keys.includes('todoist') && keys.includes('markdown'));
  assert.ok(!keys.includes('reminders'));
  assert.strictEqual(keys[keys.length - 1], 'manual');
  assert.ok(win.errors.some(e => e.includes('broken.js')));
  assert.ok(loadConnectors({ platform: 'darwin' }).byKey.has('reminders'));
});

test('a folder with index.js loads only its entry point', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'index.js'),
    "module.exports = { connectors: [{ key: 'one', label: 'One', ingest: async () => ({ notes: [] }) }] };");
  fs.writeFileSync(path.join(dir, 'side-effect.js'), 'throw new Error("must not run")');
  const r = loadConnectors({ extraDirs: [dir] });
  assert.ok(r.byKey.has('one'));
  assert.strictEqual(r.errors.length, 0);
});

test('resolveConfig layers field defaults, window default, saved values', () => {
  const cfg = resolveConfig(markdown, { cap: 4 });
  assert.strictEqual(cfg.cap, 4);
  assert.strictEqual(cfg.includeUndated, true);
  assert.strictEqual(cfg.dueWithinDays, 7);
});
