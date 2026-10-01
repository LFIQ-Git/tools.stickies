const COLORS = {
  tax:    '#FFCC94',
  cal:    '#E9E9E9',
  sticks: '#E4CCF7',
  commit: '#BFEBDD',
  feed:   '#F6C4C4',
  primer: '#FFF9A6',
  kit:    '#BFE0FF',
  manual: '#C9F2C7',
};
const LABELS = { tax: 'Tax', cal: 'Cal', sticks: 'Sticks', commit: 'Commit', feed: 'Alert', primer: 'Primer', kit: 'Kit', manual: 'Note' };

let note = null;
let expanded = false;

const $ = id => document.getElementById(id);
const card = $('card'), sourceEl = $('source'), deadlineEl = $('deadline'),
      dateInput = $('dateInput'), doneBtn = $('done'), pinBtn = $('pin'),
      closeBtn = $('close'), textEl = $('text'), expandBtn = $('expand');

// Fallback summarizer for manual/edited notes (mirrors ingest.js).
function summarize(t) {
  if (t.length <= 90) return t;
  const boundaries = [];
  for (const sep of [' — ', '. ', '; ', ': ']) {
    let i = t.indexOf(sep);
    while (i !== -1) { boundaries.push(i + (sep === '. ' ? 1 : 0)); i = t.indexOf(sep, i + 1); }
  }
  boundaries.sort((a, b) => a - b);
  for (const b of boundaries) if (b >= 20 && b <= 90) return t.slice(0, b).trim();
  return t.slice(0, 79).trimEnd() + '…';
}

function summaryOf() {
  return note.userEdited || !note.summary ? summarize(note.text || '') : note.summary;
}

function fmtDeadline(iso) {
  if (!iso) return { label: '+ date', cls: '' };
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) + 'T00:00:00');
  const due = new Date(iso + 'T00:00:00');
  const days = Math.round((due - today) / 86400000);
  const short = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (days < 0) return { label: `OVERDUE ${-days}d`, cls: 'overdue' };
  if (days === 0) return { label: 'Today', cls: 'today' };
  if (days === 1) return { label: 'Tomorrow', cls: 'tomorrow' };
  return { label: `${short} · ${days}d`, cls: '' };
}

function render() {
  document.documentElement.style.setProperty('--paper', COLORS[note.source] || COLORS.manual);
  sourceEl.textContent = LABELS[note.source] || note.source;
  sourceEl.classList.toggle('inert', !note.sourceFile);
  sourceEl.title = note.sourceFile ? 'Open source in markdown viewer' : '';

  if (note.deadline == null && note.kind) {
    deadlineEl.textContent = note.kind === 'overdue' ? 'PAST DUE' : 'ASAP';
    deadlineEl.className = 'asap';
  } else {
    const { label, cls } = fmtDeadline(note.deadline);
    deadlineEl.textContent = label;
    deadlineEl.className = cls;
  }

  pinBtn.textContent = note.pinned === false ? '⚪' : '📌';
  pinBtn.title = note.pinned === false ? 'Pin back on top' : 'Send to background';
  card.classList.toggle('unpinned', note.pinned === false);

  const summary = summaryOf();
  const hasMore = (note.text || '') !== summary;
  expandBtn.style.display = hasMore ? '' : 'none';
  expandBtn.textContent = expanded ? '▲ less' : '▼ more';
  if (document.activeElement !== textEl) {
    textEl.textContent = expanded || !hasMore ? (note.text || '') : summary;
  }
  requestAnimationFrame(() => stickies.reportHeight(card.scrollHeight));
}

expandBtn.addEventListener('click', () => { expanded = !expanded; render(); });

// ---- editing (always operates on the full text) ----
function startEdit() {
  expanded = true;
  textEl.textContent = note.text || '';
  textEl.setAttribute('contenteditable', 'true');
  textEl.focus();
  const r = document.createRange();
  r.selectNodeContents(textEl);
  r.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  render();
}
function endEdit() {
  textEl.removeAttribute('contenteditable');
  const t = textEl.innerText.replace(/\n{3,}/g, '\n\n').trim();
  if (t !== (note.text || '')) {
    note.text = t;
    note.userEdited = true;
    stickies.edit(note.id, t);
  }
  render();
}
textEl.addEventListener('dblclick', startEdit);
textEl.addEventListener('blur', () => { if (textEl.isContentEditable) endEdit(); });
textEl.addEventListener('keydown', e => {
  if (e.key === 'Escape' && textEl.isContentEditable) { e.preventDefault(); textEl.blur(); }
});
textEl.addEventListener('input', () => stickies.reportHeight(card.scrollHeight));

// ---- deadline ----
deadlineEl.addEventListener('click', () => {
  dateInput.value = note.deadline || '';
  deadlineEl.style.display = 'none';
  dateInput.style.display = 'inline-block';
  dateInput.focus();
  dateInput.showPicker?.();
});
function commitDate() {
  dateInput.style.display = 'none';
  deadlineEl.style.display = '';
  const v = dateInput.value || null;
  if (v !== note.deadline) {
    note.deadline = v;
    note.kind = null;
    stickies.setDeadline(note.id, v);
  }
  render();
}
dateInput.addEventListener('change', commitDate);
dateInput.addEventListener('blur', commitDate);

// ---- buttons ----
// DB-backed closes take a beat; show pending and block double-fires. A fresh
// note:data (sent by main on failure) re-enables the button.
doneBtn.addEventListener('click', () => {
  if (doneBtn.disabled) return;
  doneBtn.disabled = true;
  doneBtn.textContent = '⋯';
  stickies.done(note.id);
});
pinBtn.addEventListener('click', () => {
  note.pinned = note.pinned === false;
  stickies.pin(note.id, note.pinned);
  render();
});
closeBtn.addEventListener('click', () => stickies.close(note.id));
sourceEl.addEventListener('click', () => { if (note.sourceFile) stickies.openSource(note.id); });

// Wheel anywhere on a card scrolls the whole column — unless the card's own
// text is clamped and can still scroll in that direction, in which case the
// inner scroll wins.
window.addEventListener('wheel', e => {
  if (textEl.scrollHeight > textEl.clientHeight && textEl.contains(e.target)) {
    const up = e.deltaY < 0;
    const innerCan = up
      ? textEl.scrollTop > 0
      : textEl.scrollTop + textEl.clientHeight < textEl.scrollHeight - 1;
    if (innerCan) return;
  }
  stickies.scroll(e.deltaY);
}, { passive: true });

// ---- keyboard (active card; ignored while editing text or picking a date) ----
// space/enter expand · e edit · d done · x/backspace hide · p pin · ↑/↓ step column
window.addEventListener('keydown', e => {
  if (!note || textEl.isContentEditable || e.target === dateInput) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') { e.preventDefault(); expanded = !expanded; render(); }
  else if (k === 'e' || k === 'f2') { e.preventDefault(); startEdit(); }
  else if (k === 'd') { e.preventDefault(); doneBtn.click(); }
  else if (k === 'x' || k === 'backspace') { e.preventDefault(); stickies.close(note.id); }
  else if (k === 'p') { e.preventDefault(); pinBtn.click(); }
  else if (k === 'arrowup') { e.preventDefault(); stickies.step(-1); }
  else if (k === 'arrowdown') { e.preventDefault(); stickies.step(1); }
});

stickies.onData(n => {
  const firstLoad = note === null;
  note = n;
  doneBtn.disabled = false;
  doneBtn.textContent = '✓';
  render();
  if (firstLoad && n.startEditing) startEdit();
});
stickies.ready();
