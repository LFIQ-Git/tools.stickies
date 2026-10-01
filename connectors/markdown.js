// Markdown checklists: every open `- [ ] task` line in the files you pick.
// Works with Obsidian, Logseq, Notion exports, plain notes, anything that
// writes GitHub-style task lists. ✓ ticks the box in the file.
//
// Due dates are read from the common inline conventions and stripped from
// the card text:  📅 2026-10-03 (Obsidian Tasks) · due:2026-10-03 ·
// [due:: 2026-10-03] (Dataview) · @due(2026-10-03) (TaskPaper).
const fs = require('fs');
const path = require('path');
const { todayLocal, hash, stripMd, clip, summarize, lines, writeFileAtomic, withinWindow } = require('./util');

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s+)(.*)$/;
const DUE_RES = [
  /📅\s*(\d{4}-\d{2}-\d{2})/u,
  /\[due::\s*(\d{4}-\d{2}-\d{2})\]/i,
  /@due\((\d{4}-\d{2}-\d{2})\)/i,
  /\bdue:(\d{4}-\d{2}-\d{2})\b/i,
];

/** Pull the due date out of a task body and return the cleaned text. */
function parseTaskBody(body) {
  let deadline = null;
  let text = body;
  for (const re of DUE_RES) {
    const m = text.match(re);
    if (m) {
      deadline = deadline || m[1];
      text = text.replace(re, ' ');
    }
  }
  // Other Obsidian Tasks emoji fields (start, scheduled, created, priority)
  // are metadata, not part of the sentence.
  text = text.replace(/[⏳🛫➕✅]\s*\d{4}-\d{2}-\d{2}/gu, ' ').replace(/[⏫🔼🔽🔺⏬]/gu, ' ');
  return { deadline, text: stripMd(text.replace(/\s+/g, ' ').trim()) };
}

/** Open tasks in one markdown document. Pure; exported for tests. */
function parseMarkdownTasks(md) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(TASK_RE);
    if (!m || m[2] !== ' ') continue;
    const { deadline, text } = parseTaskBody(m[4]);
    if (text) out.push({ raw: line, deadline, text });
  }
  return out;
}

async function ingest(cfg) {
  const files = lines(cfg.files);
  if (!files.length) return { notes: [], error: 'no files chosen (Settings)' };
  const notes = [];
  const missing = [];
  for (const file of files) {
    let md;
    try { md = fs.readFileSync(file, 'utf8'); }
    catch { missing.push(path.basename(file)); continue; }
    for (const t of parseMarkdownTasks(md)) {
      if (!withinWindow(t.deadline, cfg)) continue;
      const text = clip(t.text);
      notes.push({
        id: `md:${hash(file)}:${hash(t.text)}`,
        source: 'markdown',
        text,
        summary: summarize(text),
        deadline: t.deadline,
        sourceFile: file,
        raw: t.raw,
        createdDate: todayLocal(),
      });
    }
  }
  const cap = Number(cfg.cap) || 0;
  const kept = cap ? notes.slice(0, cap) : notes;
  return { notes: kept, error: missing.length ? `not found: ${missing.join(', ')}` : undefined };
}

/** Tick the exact source line. Refuses if the line changed since ingest. */
async function done(note) {
  const content = fs.readFileSync(note.sourceFile, 'utf8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const all = content.split(/\r?\n/);
  const i = all.indexOf(note.raw);
  if (i === -1) throw new Error('The task line changed in the file since the last refresh, so it was left alone. Refresh and try again.');
  all[i] = note.raw.replace(TASK_RE, (m, a, box, b, rest) => `${a}x${b}${rest}`);
  writeFileAtomic(note.sourceFile, all.join(eol));
}

module.exports = {
  key: 'markdown',
  label: 'Markdown checklists',
  chip: 'List',
  color: '#FFF9A6',
  order: 30,
  live: true,
  description: 'Open "- [ ]" tasks from Markdown or text files (Obsidian, Logseq, any notes app). Checking a card ticks the box in the file.',
  fields: [
    { name: 'files', label: 'Files', type: 'files', extensions: ['md', 'markdown', 'txt'], help: 'One or more .md or .txt files.' },
    { name: 'includeUndated', label: 'Show tasks without a due date', type: 'boolean', default: true },
    { name: 'cap', label: 'Most cards to show', type: 'number', default: 15 },
  ],
  window: { field: 'dueWithinDays', label: 'Markdown tasks', choices: [0, 1, 3, 7, 14, 30], default: 7 },
  ingest,
  done,
  parseMarkdownTasks,
};
