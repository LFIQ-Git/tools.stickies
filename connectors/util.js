// Text and date helpers shared by every connector. Dates are local calendar
// dates (YYYY-MM-DD) in the machine's own time zone; never derive them from
// toISOString(), which is UTC and lands on the wrong day in the evening.
const crypto = require('crypto');
const fs = require('fs');

function todayLocal() {
  return new Date().toLocaleDateString('en-CA');
}

/** Local calendar date of a Date object as YYYY-MM-DD. */
function localDate(d) {
  return d.toLocaleDateString('en-CA');
}

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(todayLocal() + 'T00:00:00');
  const due = new Date(iso + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

function hash(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);
}

function stripMd(s) {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .trim();
}

function clip(s, max = 300) {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// Short face text for the collapsed card: cut at the first natural clause
// boundary between 20 and 90 chars, else hard-clip.
function summarize(t) {
  if (t.length <= 90) return t;
  const boundaries = [];
  for (const sep of [' — ', '. ', '; ', ': ']) {
    let i = t.indexOf(sep);
    while (i !== -1) { boundaries.push(i + (sep === '. ' ? 1 : 0)); i = t.indexOf(sep, i + 1); }
  }
  boundaries.sort((a, b) => a - b);
  for (const b of boundaries) if (b >= 20 && b <= 90) return t.slice(0, b).trim();
  return clip(t, 80);
}

/** Lines of a settings textarea or list, trimmed, blanks dropped. */
function lines(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/** Write via a temp file and rename so a crash never leaves half a file. */
function writeFileAtomic(file, content) {
  const tmp = `${file}.stickies-${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

/** Keep dated items inside the window (past due always counts). */
function withinWindow(deadline, cfg) {
  if (!deadline) return cfg.includeUndated !== false;
  const d = daysUntil(deadline);
  return cfg.dueWithinDays == null || d <= Number(cfg.dueWithinDays);
}

module.exports = { todayLocal, localDate, daysUntil, hash, stripMd, clip, summarize, lines, writeFileAtomic, withinWindow };
