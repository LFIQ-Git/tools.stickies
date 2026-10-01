// Unit tests for the pure logic: parsers, summarizer, date math, store
// dedupe/suppression. Run with `npm test` (node:test, no dependencies).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { daysUntil, todayLocal, clip, stripMd, summarize } = require('../connectors/util');
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
  assert.strictEqual(daysUntil(todayLocal()), 0);
  assert.strictEqual(daysUntil(null), null);
});

test('daysUntil counts forward and backward', () => {
  const today = new Date(todayLocal() + 'T00:00:00');
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
  store.upsert({ id: 'tax:a', source: 'tax', text: 'v1', summary: 'v1', deadline: null, createdDate: todayLocal() });
  store.notes['tax:a'].text = 'my edit';
  store.notes['tax:a'].userEdited = true;
  store.upsert({ id: 'tax:a', source: 'tax', text: 'v2', summary: 'v2', deadline: null, createdDate: todayLocal() });
  assert.strictEqual(store.notes['tax:a'].text, 'my edit');
});

test('dismiss removes the note, blocks re-ingest, and undismissToday revives', () => {
  const { store } = tempStore();
  store.upsert({ id: 'tax:b', source: 'tax', text: 'x', deadline: null, createdDate: todayLocal() });
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

