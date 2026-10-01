// Justin's routine sources (private; never packaged). Pulls to-do items out of:
//   tax    — deadlines.json (Dropbox canonical, SSD mirror fallback)
//   primer — today's daily primer markdown (PKM/primers)
//   kit    — today's Kit morning brief inside the Obsidian daily note (PKM/daily)
// Returns plain note objects; main.js merges them into the store.
const fs = require('fs');
const crypto = require('crypto');
const { todayPT } = require('./helpers');

function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
}

function stripMd(s) {
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`(.*?)`/g, '$1')
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

// "8/31" or "08/31" at the start of a bullet → ISO date this year (PT).
function mdDateToISO(m, d) {
  const year = new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric' });
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date(todayPT() + 'T00:00:00');
  const due = new Date(iso + 'T00:00:00');
  return Math.round((due - today) / 86400000);
}

function ingestTax(cfg) {
  const notes = [];
  const file = cfg.paths.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
  if (!file) return { notes, error: 'deadlines.json not reachable' };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { notes, error: 'deadlines.json parse: ' + e.message }; }
  // Drill-down reads the formatted checklist; done-writes go to deadlines.json,
  // but ONLY the Dropbox canonical (paths[0]) — the SSD mirror is read-only.
  const checklist = file.replace(/deadlines\.json$/, 'CHECKLIST.md');
  const viewFile = fs.existsSync(checklist) ? checklist : file;
  const dataFile = file === cfg.paths[0] ? file : null;
  for (const item of doc.items || []) {
    if (item.done) continue;
    // Dated items due soon (or past due) make the board. Undated items only
    // if flagged overdue — the undated ASAP backlog isn't today/tomorrow.
    const du = daysUntil(item.due);
    const within = item.due != null ? du <= cfg.includeDueWithinDays : item.kind === 'overdue';
    if (!within) continue;
    let text = `${item.who}: ${item.title}`;
    if (item.amount) text += ` — $${Number(item.amount).toLocaleString()}`;
    text = clip(stripMd(text));
    notes.push({
      id: `tax:${item.id}`,
      source: 'tax',
      text,
      summary: summarize(text),
      deadline: item.due || null,
      kind: item.kind || null,
      sourceFile: viewFile,
      dataFile,
      taxItemId: item.id,
      createdDate: todayPT(),
    });
  }
  return { notes };
}

// Grab the lines belonging to a bold-numbered primer section like
// "**3. Need to Do Today**" up to the next "**N." header.
function primerSection(md, header) {
  const re = new RegExp(`\\*\\*\\d+\\.\\s*${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\*\\*\\d+\\.|$)`);
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function ingestPrimer(cfg) {
  const notes = [];
  const date = todayPT();
  const file = `${cfg.dir}/primer-${date}.md`;
  let md;
  try { md = fs.readFileSync(file, 'utf8'); }
  catch { return { notes, error: `no primer for ${date}` }; }

  const oneThing = primerSection(md, 'The One Thing');
  if (oneThing) {
    const text = clip('THE ONE THING — ' + stripMd(oneThing.replace(/\n+/g, ' ')));
    notes.push({
      id: `primer:${date}:onething`,
      source: 'primer',
      text,
      summary: summarize(text),
      raw: oneThing.split('\n')[0].trim(),
      deadline: date,
      sourceFile: file,
      createdDate: date,
    });
  }

  const todo = primerSection(md, 'Need to Do Today');
  if (todo) {
    const items = todo.split(/\n(?=\d+\.\s)/).map(s => s.trim()).filter(s => /^\d+\.\s/.test(s));
    for (const item of items) {
      const text = clip(stripMd(item.replace(/^\d+\.\s*/, '').replace(/\n+/g, ' ')));
      notes.push({
        id: `primer:${date}:${hash(text)}`,
        source: 'primer',
        text,
        summary: summarize(text),
        raw: item.split('\n')[0].trim(),
        deadline: date,
        sourceFile: file,
        createdDate: date,
      });
    }
  }
  return { notes };
}

// Kit brief sections are "## TODAY'S BOARD" / "## DEADLINES THIS WEEK".
function kitSection(md, header) {
  const re = new RegExp(`##\\s*${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i');
  const m = md.match(re);
  return m ? m[1].trim() : null;
}

function ingestKit(cfg) {
  const notes = [];
  const date = todayPT();
  const file = `${cfg.dir}/${date}.md`;
  let md;
  try { md = fs.readFileSync(file, 'utf8'); }
  catch { return { notes, error: `no daily note for ${date}` }; }

  const bullets = section =>
    (section || '').split('\n').filter(l => l.trim().startsWith('- ')).map(l => l.trim());

  for (const rawLine of bullets(kitSection(md, "TODAY'S BOARD"))) {
    const text = clip(stripMd(rawLine.slice(2)));
    notes.push({
      id: `kit:${date}:board:${hash(text)}`,
      source: 'kit',
      text,
      summary: summarize(text),
      raw: rawLine,
      deadline: date,
      sourceFile: file,
      createdDate: date,
    });
  }

  for (const rawLine of bullets(kitSection(md, 'DEADLINES THIS WEEK'))) {
    const plain = stripMd(rawLine.slice(2));
    let deadline = null;
    const dm = plain.match(/^(\d{1,2})\/(\d{1,2})/);
    if (dm) deadline = mdDateToISO(dm[1], dm[2]);
    else if (/^today/i.test(plain)) deadline = date;
    const text = clip(plain);
    notes.push({
      id: `kit:${date}:deadline:${hash(text)}`,
      source: 'kit',
      text,
      summary: summarize(text),
      raw: rawLine,
      deadline,
      sourceFile: file,
      createdDate: date,
    });
  }
  return { notes };
}

module.exports = { ingestTax, ingestPrimer, ingestKit, daysUntil, todayPT, clip, stripMd, summarize };
