// Todoist via the unified API v1 and a personal API token
// (Todoist → Settings → Integrations → Developer). ✓ closes the task in
// Todoist; recurring tasks roll forward to their next date, as in the app.
const { todayLocal, clip, summarize } = require('./util');

const API = 'https://api.todoist.com/api/v1';

async function call(token, method, pathAndQuery) {
  const res = await fetch(`${API}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Todoist rejected the API token');
  if (!res.ok) throw new Error(`Todoist ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.status === 204 ? null : res.json();
}

async function ingest(cfg) {
  if (!cfg.token) return { notes: [], error: 'no API token (Settings)' };
  const cap = Number(cfg.cap) || 15;
  const query = encodeURIComponent(cfg.filter || 'today | overdue');
  try {
    const body = await call(cfg.token, 'GET', `/tasks/filter?query=${query}&limit=${Math.min(200, cap * 2)}`);
    const tasks = Array.isArray(body) ? body : (body?.results || []);
    // Todoist priority 4 is "P1" (most urgent).
    tasks.sort((a, b) => (b.priority || 1) - (a.priority || 1)
      || String(a.due?.date || '9').localeCompare(String(b.due?.date || '9')));
    const notes = tasks.slice(0, cap).map(t => {
      const desc = (t.description || '').replace(/\s+/g, ' ').trim();
      const text = clip(desc ? `${t.content} — ${desc}` : t.content);
      const due = t.due?.date ? String(t.due.date).slice(0, 10) : null;
      return {
        id: `todoist:${t.id}`,
        source: 'todoist',
        text,
        summary: summarize(t.content),
        deadline: due,
        sourceFile: null,
        sourceUrl: `https://app.todoist.com/app/task/${t.id}`,
        externalId: String(t.id),
        createdDate: todayLocal(),
      };
    });
    return { notes };
  } catch (e) {
    return { notes: [], error: e.name === 'TimeoutError' ? 'Todoist timed out' : e.message };
  }
}

async function done(note, cfg) {
  if (!cfg.token) throw new Error('No Todoist API token in Settings.');
  await call(cfg.token, 'POST', `/tasks/${encodeURIComponent(note.externalId)}/close`);
}

module.exports = {
  key: 'todoist',
  label: 'Todoist',
  chip: 'Todoist',
  color: '#FFD3CC',
  order: 20,
  live: true,
  description: 'Tasks from Todoist that match a filter. Checking a card completes the task in Todoist.',
  fields: [
    { name: 'token', label: 'API token', type: 'secret', help: 'Todoist → Settings → Integrations → Developer → API token.' },
    { name: 'filter', label: 'Filter', type: 'text', default: 'today | overdue', help: 'Any Todoist filter query, for example "today | overdue | p1".' },
    { name: 'cap', label: 'Most cards to show', type: 'number', default: 15 },
  ],
  ingest,
  done,
};
