// todo.txt (todotxt.org format). Open lines become cards; due:YYYY-MM-DD sets
// the deadline. ✓ completes the line the standard way:
// "x <today> <rest>" with the priority kept as pri:X.
const fs = require('fs');
const { todayLocal, hash, clip, summarize, writeFileAtomic, withinWindow } = require('./util');

const PRI_RE = /^\(([A-Z])\)\s+/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}\s+/;

/** Parse one todo.txt line; null for blank or completed lines. Exported for tests. */
function parseTodoLine(line) {
  if (!line.trim() || /^x\s/.test(line)) return null;
  let rest = line.trim();
  let priority = null;
  const pm = rest.match(PRI_RE);
  if (pm) { priority = pm[1]; rest = rest.slice(pm[0].length); }
  rest = rest.replace(DATE_RE, ''); // creation date
  const dm = rest.match(/(?:^|\s)due:(\d{4}-\d{2}-\d{2})\b/);
  const deadline = dm ? dm[1] : null;
  const text = rest.replace(/(?:^|\s)due:\d{4}-\d{2}-\d{2}\b/, ' ').replace(/\s+/g, ' ').trim();
  return { raw: line, priority, deadline, text: priority ? `(${priority}) ${text}` : text };
}

function completeLine(line, today) {
  let rest = line.trim();
  const pm = rest.match(PRI_RE);
  if (pm) rest = rest.slice(pm[0].length) + ` pri:${pm[1]}`;
  return `x ${today} ${rest}`;
}

async function ingest(cfg) {
  if (!cfg.file) return { notes: [], error: 'no todo.txt chosen (Settings)' };
  let content;
  try { content = fs.readFileSync(cfg.file, 'utf8'); }
  catch { return { notes: [], error: 'todo.txt not found' }; }
  const items = content.split(/\r?\n/).map(parseTodoLine).filter(Boolean)
    .filter(t => withinWindow(t.deadline, cfg))
    // Priority first (A before B before none), then soonest due.
    .sort((a, b) => (a.priority || '~').localeCompare(b.priority || '~') || (a.deadline || '9').localeCompare(b.deadline || '9'));
  const cap = Number(cfg.cap) || 0;
  const notes = (cap ? items.slice(0, cap) : items).map(t => {
    const text = clip(t.text);
    return {
      id: `todotxt:${hash(t.raw.trim())}`,
      source: 'todotxt',
      text,
      summary: summarize(text),
      deadline: t.deadline,
      sourceFile: cfg.file,
      raw: t.raw,
      createdDate: todayLocal(),
    };
  });
  return { notes };
}

async function done(note) {
  const content = fs.readFileSync(note.sourceFile, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const all = content.split(/\r?\n/);
  const i = all.indexOf(note.raw);
  if (i === -1) throw new Error('The line changed in todo.txt since the last refresh, so it was left alone. Refresh and try again.');
  all[i] = completeLine(note.raw, todayLocal());
  writeFileAtomic(note.sourceFile, all.join(eol));
}

module.exports = {
  key: 'todotxt',
  label: 'todo.txt',
  chip: 'todo',
  color: '#FFE1BD',
  order: 35,
  live: true,
  description: 'Tasks from a todo.txt file. Checking a card marks the line complete in the file.',
  fields: [
    { name: 'file', label: 'todo.txt file', type: 'file', extensions: ['txt'] },
    { name: 'includeUndated', label: 'Show tasks without a due date', type: 'boolean', default: true },
    { name: 'cap', label: 'Most cards to show', type: 'number', default: 15 },
  ],
  window: { field: 'dueWithinDays', label: 'todo.txt tasks', choices: [0, 1, 3, 7, 14, 30], default: 7 },
  ingest,
  done,
  parseTodoLine,
  completeLine,
};
