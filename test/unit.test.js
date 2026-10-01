// Unit tests for the pure logic: parsers, summarizer, date math, store
// dedupe/suppression. Run with `npm test` (node:test, no dependencies).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { daysUntil, todayPT, clip, stripMd, summarize } = require('../ingest');
const Store = require('../store');

// ---- summarize ----
test('summarize returns short text unchanged', () => {
  const s = 'JS: Pay IRS 2023 balance — $28,024.84';
  assert.strictEqual(summarize(s), s);
});

test('summarize cuts at the first natural boundary past 20 chars', () => {
  const s = 'Mosser Towers final $50K wire — told lender Scott on 8/20 it would go Monday, confirm it went out today';
  assert.strictEqual(summarize(s), 'Mosser Towers final $50K wire');
});

test('summarize hard-clips when no boundary lands in range', () => {
  const s = 'x'.repeat(200);
  const out = summarize(s);
  assert.ok(out.length <= 80);
  assert.ok(out.endsWith('…'));
});

// ---- clip / stripMd ----
test('clip truncates with ellipsis at the limit', () => {
  assert.strictEqual(clip('abc', 10), 'abc');
  const long = 'y'.repeat(400);
  const out = clip(long);
  assert.strictEqual(out.length, 300);
  assert.ok(out.endsWith('…'));
});

test('stripMd removes bold, italics, code, links', () => {
  assert.strictEqual(stripMd('**8/31:** pay `IRS` [link](http://x) *now*'), '8/31: pay IRS link now');
});

// ---- date math ----
test('daysUntil is 0 for today (PT) and null-safe', () => {
  assert.strictEqual(daysUntil(todayPT()), 0);
  assert.strictEqual(daysUntil(null), null);
});

test('daysUntil counts forward and backward', () => {
  const today = new Date(todayPT() + 'T00:00:00');
  const plus3 = new Date(today.getTime() + 3 * 86400000);
  const iso = plus3.toLocaleDateString('en-CA');
  assert.strictEqual(daysUntil(iso), 3);
});

// ---- store ----
function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-test-'));
  return { store: new Store(dir), dir };
}

test('upsert refreshes source text but never clobbers user edits', () => {
  const { store } = tempStore();
  store.upsert({ id: 'tax:a', source: 'tax', text: 'v1', summary: 'v1', deadline: null, createdDate: todayPT() });
  store.notes['tax:a'].text = 'my edit';
  store.notes['tax:a'].userEdited = true;
  store.upsert({ id: 'tax:a', source: 'tax', text: 'v2', summary: 'v2', deadline: null, createdDate: todayPT() });
  assert.strictEqual(store.notes['tax:a'].text, 'my edit');
});

test('dismiss removes the note, blocks re-ingest, and undismissToday revives', () => {
  const { store } = tempStore();
  store.upsert({ id: 'tax:b', source: 'tax', text: 'x', deadline: null, createdDate: todayPT() });
  store.dismiss('tax:b');
  assert.ok(!store.notes['tax:b']);
  assert.ok(store.isDismissed('tax:b'));
  store.undismissToday();
  assert.ok(!store.isDismissed('tax:b'));
});

test('isCompleted fuzzy-matches day-to-day drift', () => {
  const { store } = tempStore();
  store.addCompleted('Corrected 2024 capital statement — now 3 days overdue, signed corrected statement to each partner');
  assert.ok(store.isCompleted('Corrected 2024 capital statement — now 4 days overdue, signed corrected statement to each partner'));
  assert.ok(!store.isCompleted('Mail the §6698 abatement request to Ogden, certified with return receipt'));
});

test('corrupt store file is backed up, not silently wiped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-test-'));
  fs.writeFileSync(path.join(dir, 'stickies-store.json'), '{not json');
  const store = new Store(dir);
  assert.deepStrictEqual(store.data.notes, {});
  const backups = fs.readdirSync(dir).filter(f => f.includes('.corrupt-'));
  assert.strictEqual(backups.length, 1);
});

// ---- primer/kit parsing against fixture files ----
test('primer parser extracts one-thing and numbered need-to-do items', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-test-'));
  const date = todayPT();
  fs.writeFileSync(path.join(dir, `primer-${date}.md`), [
    '# Your Daily Primer — Test',
    '',
    '**1. The One Thing**',
    'Ship the thing. It matters most.',
    '',
    '**2. Need to Know**',
    '- context',
    '',
    '**3. Need to Do Today**',
    '1. First task — due 8/31.',
    '2. Second task with detail.',
    '',
    '**4. Follow-Ups**',
    '- none',
  ].join('\n'));
  const { ingestAll } = require('../ingest');
  return ingestAll({ primer: { dir } }, { tax: false, sticks: false, commit: false, feed: false, cal: false, kit: false })
    .then(r => {
      assert.strictEqual(r.errors.length, 0);
      const texts = r.notes.map(n => n.text);
      assert.strictEqual(r.notes.length, 3);
      assert.ok(texts[0].startsWith('THE ONE THING'));
      assert.ok(texts.some(t => t.includes('First task')));
      assert.ok(r.notes.every(n => n.deadline === todayPT()));
    });
});

test('kit parser extracts board bullets and parses deadline dates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stickies-test-'));
  const date = todayPT();
  fs.writeFileSync(path.join(dir, `${date}.md`), [
    `# ${date}`,
    '',
    'Company Morning Brief — Test | Sticks',
    '',
    "## TODAY'S BOARD",
    '- **Wire the $50K** — promised for today.',
    '',
    '## DEADLINES THIS WEEK',
    '- **12/31:** year-end item.',
    '- Context line without a date.',
    '',
    '## CALENDAR',
    '- 10:00 AM — a meeting',
  ].join('\n'));
  const { ingestAll } = require('../ingest');
  return ingestAll({ kit: { dir } }, { tax: false, sticks: false, commit: false, feed: false, cal: false, primer: false })
    .then(r => {
      assert.strictEqual(r.errors.length, 0);
      assert.strictEqual(r.notes.length, 3);
      const dated = r.notes.find(n => n.text.startsWith('12/31'));
      assert.ok(dated.deadline.endsWith('-12-31'));
      const board = r.notes.find(n => n.text.includes('Wire the $50K'));
      assert.strictEqual(board.deadline, date);
    });
});

// ---- agent feed grouping ----
// Repeating machine alerts must collapse to one card, otherwise a failing cron
// writes 70 identical stickies and dismissing one leaves 69 to resurface.
const { feedGroupKey } = require('../sticks');

test('feedGroupKey collapses repeated cron failures per job', () => {
  assert.strictEqual(
    feedGroupKey('Cron failure: graph-report-imports'),
    feedGroupKey('Cron failure: graph-report-imports')
  );
  assert.notStrictEqual(
    feedGroupKey('Cron failure: graph-report-imports'),
    feedGroupKey('Cron failure: m365-graph-pull')
  );
});

test('feedGroupKey collapses the re-titled reconcile digest', () => {
  const a = feedGroupKey('Daily Reconcile — Aug 30 | 1 urgent, 3 calls needed + 6,993 junk tasks ready to clear');
  const b = feedGroupKey('🔴 Fast Reconcile — Aug 30 | 1 Action Item + Junk Backlog Ready to Clear');
  const c = feedGroupKey('Reconcile 2026-08-28 — 3 flags + 6,912-task junk backlog ready to clear');
  assert.strictEqual(a, b);
  assert.strictEqual(b, c);
});

test('feedGroupKey strips dates and counts but keeps distinct subjects apart', () => {
  assert.strictEqual(
    feedGroupKey('Rent posting exception 2026-08-30 — 3 units'),
    feedGroupKey('Rent posting exception 2026-08-29 — 11 units')
  );
  assert.notStrictEqual(
    feedGroupKey('Close task from email to Sam Teasdale?'),
    feedGroupKey('Close task from email to Patrick Malcolm?')
  );
});

test('recurring digests rank below one-off alerts', () => {
  const { classifyFeedTitle } = require('../sticks');
  for (const t of ['Daily Reconcile — Aug 30 | 3 calls needed',
                   'Cron failure: m365-graph-pull',
                   'Commitment sweep — archived 4',
                   'Report import stale: 1 report']) {
    assert.strictEqual(classifyFeedTitle(t).recurring, true, t);
  }
  for (const t of ['Mosser Towers loan maturity in 72 days — no update in 27 days',
                   'Six cure deadlines have passed with no recorded update',
                   'Close task from email to Patrick Malcolm?']) {
    assert.strictEqual(classifyFeedTitle(t).recurring, false, t);
  }
});

test('templated feed titles are too similar to fuzzy-dedupe against each other', () => {
  // Guards the main.js rule that exempts feed-vs-feed from the dedupe: these
  // two are DIFFERENT alerts but score above the 0.6 threshold on boilerplate.
  const a = Store.wordSet('Close task from email to Patrick Malcolm?');
  const b = Store.wordSet('Close task from email to San Francisco Department of Building Inspection?');
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  assert.ok(inter / Math.min(a.size, b.size) >= 0.6);
  assert.notStrictEqual(feedGroupKey('Close task from email to Patrick Malcolm?'),
                        feedGroupKey('Close task from email to San Francisco Department of Building Inspection?'));
});
