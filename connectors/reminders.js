// Apple Reminders (macOS only), read and completed through the Reminders
// scripting interface. The first refresh triggers the macOS prompt asking to
// let Stickies control Reminders; nothing leaves the machine.
const { execFile } = require('child_process');
const { todayLocal, localDate, clip, summarize, lines, withinWindow } = require('./util');

function jxa(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', script, ...args], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message);
          if (/-1743|not allowed|Not authorized/i.test(msg)) {
            reject(new Error('Stickies is not allowed to control Reminders. Turn it on in System Settings → Privacy & Security → Automation.'));
          } else reject(new Error(msg.trim().slice(0, 160)));
        } else resolve(stdout);
      });
  });
}

// Batch property reads (one Apple Event per property per list) keep this fast
// even with large lists.
const READ = `
function run(argv) {
  const want = JSON.parse(argv[0] || '[]');
  const app = Application('Reminders');
  const out = [];
  for (const list of app.lists()) {
    const name = list.name();
    if (want.length && !want.includes(name)) continue;
    const rs = list.reminders.whose({ completed: false });
    const ids = rs.id(), titles = rs.name(), dues = rs.dueDate(), bodies = rs.body(), prios = rs.priority();
    for (let i = 0; i < ids.length; i++) {
      out.push({ id: ids[i], title: titles[i], due: dues[i] ? dues[i].toISOString() : null,
                 body: bodies[i] || '', priority: prios[i] || 0, list: name });
    }
  }
  return JSON.stringify(out);
}`;

const COMPLETE = `
function run(argv) {
  const r = Application('Reminders').reminders.byId(argv[0]);
  r.completed = true;
  return 'ok';
}`;

async function ingest(cfg) {
  if (process.platform !== 'darwin') return { notes: [] };
  try {
    const items = JSON.parse(await jxa(READ, [JSON.stringify(lines(cfg.lists))]));
    const rows = items.map(r => ({ ...r, deadline: r.due ? localDate(new Date(r.due)) : null }))
      .filter(r => withinWindow(r.deadline, cfg))
      // Reminders priority: 1 high, 5 medium, 9 low, 0 none.
      .sort((a, b) => (a.priority || 10) - (b.priority || 10) || String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
    const cap = Number(cfg.cap) || 15;
    const notes = rows.slice(0, cap).map(r => {
      const body = r.body.replace(/\s+/g, ' ').trim();
      const text = clip(body ? `${r.title} — ${body}` : r.title);
      return {
        id: `reminders:${r.id}`,
        source: 'reminders',
        text,
        summary: summarize(r.title),
        deadline: r.deadline,
        sourceFile: null,
        externalId: r.id,
        createdDate: todayLocal(),
      };
    });
    return { notes };
  } catch (e) {
    return { notes: [], error: e.message };
  }
}

async function done(note) {
  await jxa(COMPLETE, [note.externalId]);
}

module.exports = {
  key: 'reminders',
  label: 'Apple Reminders',
  chip: 'Remind',
  color: '#BFE0FF',
  order: 25,
  live: true,
  platforms: ['darwin'],
  description: 'Open reminders from the Reminders app (macOS). Checking a card completes the reminder.',
  fields: [
    { name: 'lists', label: 'Lists', type: 'textarea', help: 'One list name per line. Leave empty for every list.' },
    { name: 'includeUndated', label: 'Show reminders without a due date', type: 'boolean', default: false },
    { name: 'cap', label: 'Most cards to show', type: 'number', default: 15 },
  ],
  window: { field: 'dueWithinDays', label: 'Reminders', choices: [0, 1, 3, 7, 14, 30], default: 3 },
  ingest,
  done,
};
