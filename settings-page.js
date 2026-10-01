// Settings renderer. Builds one card per connector from its field schema.
const api = window.settingsApi;
const $ = id => document.getElementById(id);
let state = null;
/** key -> {name: getter} for the current form values */
const readers = {};
/** key -> {name: {clear:true}} pending secret clears */
const clears = {};

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}

function fieldControl(c, f) {
  const v = c.values[f.name];
  const help = f.help ? el('div', { class: 'help' }, f.help) : null;

  if (f.type === 'boolean') {
    const input = el('input', { type: 'checkbox', id: `${c.key}-${f.name}` });
    input.checked = !!v;
    readers[c.key][f.name] = () => input.checked;
    return el('label', { class: 'check' }, input, f.label);
  }

  if (f.secret) {
    const saved = v && v.saved;
    const input = f.type === 'textarea'
      ? el('textarea', { placeholder: saved ? 'Saved. Paste new addresses to replace them.' : '' })
      : el('input', { type: 'password', autocomplete: 'off', placeholder: saved ? 'Saved. Type to replace.' : '' });
    const note = el('span', { class: 'saved' }, saved ? 'Saved securely' : 'Not set');
    const clearBtn = saved ? el('button', { type: 'button', onclick: () => {
      clears[c.key] = clears[c.key] || {};
      clears[c.key][f.name] = { clear: true };
      note.textContent = 'Will be removed on Save';
      clearBtn.remove();
    } }, 'Remove') : null;
    readers[c.key][f.name] = () => (clears[c.key]?.[f.name]) || input.value;
    return el('label', { class: 'field' }, el('span', {}, f.label), input,
      el('div', { class: 'row', style: 'margin-top:4px' }, note, clearBtn), help);
  }

  if (f.type === 'number') {
    const input = el('input', { type: 'number', min: '0', value: v ?? '' });
    readers[c.key][f.name] = () => input.value;
    return el('label', { class: 'field' }, el('span', {}, f.label), input, help);
  }

  if (f.type === 'file' || f.type === 'files') {
    const multi = f.type === 'files';
    const input = multi
      ? el('textarea', { placeholder: 'One file path per line' })
      : el('input', { type: 'text', placeholder: 'File path' });
    input.value = multi ? (Array.isArray(v) ? v : String(v || '').split('\n')).filter(Boolean).join('\n') : (v || '');
    const pick = el('button', { type: 'button', onclick: async () => {
      const paths = await api.pickFile(multi, f.extensions);
      if (!paths.length) return;
      if (multi) {
        const existing = input.value.split('\n').map(s => s.trim()).filter(Boolean);
        input.value = [...new Set([...existing, ...paths])].join('\n');
      } else input.value = paths[0];
    } }, multi ? 'Add files…' : 'Choose…');
    readers[c.key][f.name] = () => multi ? input.value.split('\n').map(s => s.trim()).filter(Boolean) : input.value.trim();
    return el('label', { class: 'field' }, el('span', {}, f.label), el('div', { class: 'row' }, input, pick), help);
  }

  const input = f.type === 'textarea' ? el('textarea') : el('input', { type: 'text' });
  input.value = v ?? '';
  readers[c.key][f.name] = () => input.value;
  return el('label', { class: 'field' }, el('span', {}, f.label), input, help);
}

function formValues(key) {
  const out = {};
  for (const [name, get] of Object.entries(readers[key] || {})) out[name] = get();
  return out;
}

function connectorCard(c) {
  readers[c.key] = {};
  const toggle = el('input', { type: 'checkbox', 'aria-label': `Use ${c.label}` });
  toggle.checked = c.enabled;
  const card = el('section', { class: `card${c.enabled ? ' on' : ''}`, 'data-key': c.key });
  toggle.addEventListener('change', () => card.classList.toggle('on', toggle.checked));
  readers[c.key].__enabled = () => toggle.checked;

  const result = el('div', { class: 'result' });
  const testBtn = el('button', { type: 'button', onclick: async () => {
    result.className = 'result';
    result.textContent = 'Checking…';
    const values = formValues(c.key);
    delete values.__enabled;
    const r = await api.test(c.key, values);
    const lines = [];
    if (r.count != null) lines.push(`${r.count} card${r.count === 1 ? '' : 's'} right now`);
    for (const s of r.sample || []) lines.push(`• ${s}`);
    if (r.error) lines.push(`Problem: ${r.error}`);
    result.className = r.error && !r.count ? 'result err' : 'result';
    result.textContent = lines.join('\n');
  } }, 'Test');

  card.append(
    el('div', { class: 'head' },
      el('span', { class: 'swatch', style: `background:${c.color}` }),
      el('span', { class: 'title' }, c.label, c.builtIn ? null : el('span', { class: 'saved' }, '  custom')),
      el('label', { class: 'switch' }, toggle, el('span'))),
    el('div', { class: 'desc' }, c.description),
    el('div', { class: 'body' }, ...c.fields.map(f => fieldControl(c, f)),
      el('div', { class: 'row', style: 'margin-top:12px' }, testBtn), result),
  );
  return card;
}

async function load() {
  state = await api.get();
  const box = $('connectors');
  box.replaceChildren(...state.connectors.map(connectorCard));
  $('loadErrors').replaceChildren(...state.loadErrors.map(e => el('p', { class: 'warn' }, `Could not load connector: ${e}`)));
  $('refreshMinutes').value = state.general.refreshMinutes;
  $('customConnectorDir').value = state.general.customConnectorDir;
  $('version').textContent = `Stickies ${state.version}${state.packaged ? '' : ' (running from source)'}`;
}

$('pickDir').addEventListener('click', async () => {
  const dir = await api.pickDir();
  if (dir) $('customConnectorDir').value = dir;
});

$('save').addEventListener('click', async () => {
  const connectors = {};
  for (const c of state.connectors) {
    const values = formValues(c.key);
    const enabled = values.__enabled;
    delete values.__enabled;
    connectors[c.key] = { enabled, values };
  }
  await api.save({
    connectors,
    general: { refreshMinutes: $('refreshMinutes').value, customConnectorDir: $('customConnectorDir').value },
  });
  for (const k of Object.keys(clears)) delete clears[k];
  $('status').textContent = 'Saved. Refreshing your notes…';
  await load();
  setTimeout(() => { $('status').textContent = ''; }, 3000);
});

$('cancel').addEventListener('click', () => window.close());

load();
