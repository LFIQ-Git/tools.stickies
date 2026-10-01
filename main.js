// Stickies main process: note windows, tray, refresh pipeline, IPC.
// The column layout engine lives in layout.js, the edge guard in guard.js,
// the markdown viewer in viewer.js; note shapes are documented in types.js.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const { ingestAll, todayPT, daysUntil, SOURCES } = require('./ingest');
const { closeSticksTask, fulfillCommitment, dismissAgentFeedItem } = require('./sticks');
const { createColumn } = require('./layout');
const { createGuard } = require('./guard');
const { openViewer } = require('./viewer');
const config = require('./config.json');

let store;
let tray;
/** @type {Map<string, Electron.BrowserWindow>} note id -> window */
const wins = new Map();
let lastIngestErrors = [];

const NOTE = config.note;

/** Display order for the column: source rank, then stable id. */
function notesOrdered() {
  const order = { tax: 0, cal: 1, sticks: 2, commit: 3, feed: 4, primer: 5, kit: 6, manual: 7 };
  return Object.values(store.notes).sort((a, b) => {
    const s = (order[a.source] ?? 9) - (order[b.source] ?? 9);
    return s !== 0 ? s : a.id.localeCompare(b.id);
  });
}

const column = createColumn({ note: NOTE, wins, notesOrdered });

// ---- settings ----

function sourceEnabled(key) {
  return store.data.settings?.sources?.[key] !== false;
}

// Date filter: cards whose deadline is more than N days ahead are hidden.
// Past due and today always show; undated cards have nothing to filter on
// and always show. null = no limit.
const LOOKAHEAD_CHOICES = [
  { label: 'Today + past due only', value: 0 },
  { label: 'Next 1 day', value: 1 },
  { label: 'Next 3 days', value: 3 },
  { label: 'Next 7 days', value: 7 },
  { label: 'Next 14 days', value: 14 },
  { label: 'Next 30 days', value: 30 },
  { label: 'No limit', value: null },
];

function lookAheadDays() {
  const v = store.data.settings?.lookAheadDays;
  return v === undefined ? null : v;
}

/** @param {import('./types').Note} n */
function noteVisible(n) {
  const la = lookAheadDays();
  if (la == null || !n.deadline) return true;
  return daysUntil(n.deadline) <= la;
}

// Per-source ingest windows (how far ahead each feed even fetches), surfaced
// in the tray and persisted as overrides on top of config.json defaults.
const SOURCE_WINDOWS = [
  { key: 'tax',    label: 'Tax deadlines',  configKey: 'includeDueWithinDays', choices: [7, 14, 30, 60, 90] },
  { key: 'sticks', label: 'Sticks tasks',   configKey: 'dueWithinDays',        choices: [3, 7, 14, 30] },
  { key: 'commit', label: 'Commitments',    configKey: 'dueWithinDays',        choices: [7, 14, 30] },
  { key: 'feed',   label: 'Alerts max age', configKey: 'maxAgeDays',           choices: [1, 3, 7, 14] },
];

function sourceWindow(sw) {
  return store.data.settings?.sourceWindows?.[sw.key] ?? config[sw.key][sw.configKey];
}

/** Shared DB credentials live once in config.db; per-source blocks add knobs. */
function dbConfig(key) {
  return { ...config.db, ...config[key] };
}

/** config.json defaults + shared db block + tray window overrides. */
function effectiveConfig() {
  const cfg = JSON.parse(JSON.stringify(config));
  for (const key of ['sticks', 'commit', 'feed', 'cal']) cfg[key] = { ...cfg.db, ...cfg[key] };
  for (const sw of SOURCE_WINDOWS) cfg[sw.key][sw.configKey] = sourceWindow(sw);
  return cfg;
}

// ---- note windows ----

/** @param {import('./types').Note} note */
function createNoteWindow(note) {
  if (wins.has(note.id)) return wins.get(note.id);
  if (note.pinned == null) note.pinned = true;
  const wa = screen.getPrimaryDisplay().workArea;
  const spawn = note.userMoved && note.pos
    ? note.pos
    : { x: wa.x + wa.width - NOTE.width - NOTE.edgeMargin, y: wa.y + NOTE.edgeMargin };

  const win = new BrowserWindow({
    width: NOTE.width,
    height: NOTE.minHeight,
    x: Math.round(spawn.x),
    y: Math.round(spawn.y),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    acceptFirstMouse: true, // buttons respond even when the card isn't active
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.noteId = note.id;
  applyPinState(win, note.pinned);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'note.html'));

  let moveTimer;
  win.on('moved', () => {
    // Programmatic setPosition also fires 'moved'; only a move well after the
    // last layout pass counts as a user drag.
    if (Date.now() - column.lastLayoutAt() < 600) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      const n = store.notes[note.id];
      if (n) { n.pos = { x, y }; n.userMoved = true; store.save(); }
    }, 400);
  });
  win.on('closed', () => { wins.delete(note.id); column.scheduleLayout(); });

  wins.set(note.id, win);
  return win;
}

function applyPinState(win, pinned) {
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
}

/** Reconcile windows with the store + date filter, then repack the column. */
function syncWindows() {
  for (const note of notesOrdered()) {
    if (noteVisible(note)) createNoteWindow(note);
  }
  for (const [id, win] of wins) {
    const n = store.notes[id];
    if (!n || !noteVisible(n)) win.destroy();
  }
  column.scheduleLayout();
}

// ---- refresh pipeline ----

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  if (tray) tray.setTitle('⟳'); // visible refresh-in-progress indicator
  try { await doRefresh(); }
  finally {
    refreshing = false;
    if (tray) tray.setTitle('🗒');
  }
}

async function doRefresh() {
  const enabled = {};
  for (const key of Object.keys(SOURCES)) enabled[key] = sourceEnabled(key);
  const { notes, errors } = await ingestAll(effectiveConfig(), enabled);
  lastIngestErrors = errors;
  // The same item often appears in several feeds. Sticks, commitments and the
  // agent feed are the most derivative surfaces, so drop their notes that
  // fuzzy-match a primary source (tax, primer, kit) or each other.
  const DERIVATIVE = new Set(['sticks', 'commit', 'feed']);
  const kept = [];
  const deduped = [];
  for (const n of notes) {
    if (!DERIVATIVE.has(n.source)) { kept.push(n); deduped.push(n); continue; }
    const a = Store.wordSet(n.summary || n.text);
    const dup = kept.some(o => {
      // Feed cards never fuzzy-match each other: agent_feed titles are
      // templated ("Close task from email to <person>?"), so the shared
      // boilerplate alone clears the threshold and two different people's
      // alerts collapse into one card. Repeats within the feed are already
      // handled upstream by the family key.
      if (n.source === 'feed' && o.source === 'feed') return false;
      const b = Store.wordSet(o.text);
      let inter = 0;
      for (const w of a) if (b.has(w)) inter++;
      return a.size > 0 && inter / Math.min(a.size, b.size || 1) >= 0.6;
    });
    if (!dup) { kept.push(n); deduped.push(n); }
  }
  for (const n of deduped) {
    if (store.isDismissed(n.id)) continue;
    if (['primer', 'kit'].includes(n.source) && store.isCompleted(n.text)) continue;
    store.upsert(n);
  }
  // Narrowing a source window retro-removes cards beyond it (user-edited stay).
  const forwardWindows = { tax: sourceWindow(SOURCE_WINDOWS[0]), sticks: sourceWindow(SOURCE_WINDOWS[1]), commit: sourceWindow(SOURCE_WINDOWS[2]) };
  for (const [id, n] of Object.entries(store.notes)) {
    const w = forwardWindows[n.source];
    if (w != null && n.deadline && !n.userEdited && daysUntil(n.deadline) > w) {
      delete store.notes[id];
    }
  }
  // Feed cards are grouped now (`feed:<group-hash>:<date>`); one-row cards left
  // from the old `feed:<uuid>` ids can never be re-ingested, so drop them and
  // let the grouped card take over.
  for (const [id, n] of Object.entries(store.notes)) {
    if (n.source === 'feed' && !n.feedIds && !n.userEdited) delete store.notes[id];
  }
  // Calendar cards track the live day: ended or removed meetings drop off.
  const calIds = new Set(deduped.filter(n => n.source === 'cal').map(n => n.id));
  for (const [id, n] of Object.entries(store.notes)) {
    if (n.source === 'cal' && !n.userEdited && !calIds.has(id) && sourceEnabled('cal')) {
      delete store.notes[id];
    }
  }
  // A source toggled off takes its cards down with it (manual and user-edited stay).
  for (const [id, n] of Object.entries(store.notes)) {
    if (n.source !== 'manual' && enabled[n.source] === false && !n.userEdited) {
      delete store.notes[id];
    }
  }
  store.prune();
  store.save();
  syncWindows();
  for (const [id, win] of wins) {
    const n = store.notes[id];
    if (n && !win.isDestroyed()) win.webContents.send('note:data', n);
  }
  buildTray();
}

function newManualNote() {
  const id = `manual:${Date.now()}`;
  store.notes[id] = {
    id,
    source: 'manual',
    text: '',
    deadline: null,
    sourceFile: null,
    createdDate: todayPT(),
    userEdited: true,
    startEditing: true,
  };
  store.save();
  syncWindows();
}

function setAllPinned(pinned) {
  for (const [id, win] of wins) {
    const n = store.notes[id];
    if (n) n.pinned = pinned;
    applyPinState(win, pinned);
    if (!win.isDestroyed()) win.webContents.send('note:data', store.notes[id]);
  }
  store.save();
}

// ---- edge guard ----

function edgeGuardEnabled() { return store.data.settings?.edgeGuard !== false; }

const guard = createGuard({
  isActive: () => {
    if (!edgeGuardEnabled()) return false;
    for (const [id, win] of wins) {
      const n = store.notes[id];
      if (n && !n.userMoved && n.pinned !== false && !win.isDestroyed() && win.isVisible()) return true;
    }
    return false;
  },
  getLimit: () => column.insideEdge(config.edgeGuard.margin),
  getScreenX: () => screen.getPrimaryDisplay().workArea.x,
  onStateChange: () => buildTray(),
  intervalMs: config.edgeGuard.intervalMs,
});

// ---- tray ----

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('🗒');
  }
  const count = Object.keys(store.notes).length;
  const errLines = lastIngestErrors.map(e => ({ label: `⚠ ${e}`, enabled: false }));
  const guardError = guard.getError();
  if (guardError && /assistive|not allowed|1002|1743/i.test(guardError)) {
    errLines.push({ label: '⚠ Edge guard needs Accessibility + Automation for Electron', enabled: false });
    errLines.push({ label: '   (System Settings → Privacy & Security)', enabled: false });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${count} note${count === 1 ? '' : 's'}`, enabled: false },
    ...errLines,
    { type: 'separator' },
    { label: 'Refresh from routines', click: refresh },
    { label: 'Sources', submenu: Object.entries(SOURCES).map(([key, src]) => ({
      label: src.label,
      type: 'checkbox',
      checked: sourceEnabled(key),
      click: item => {
        store.data.settings = store.data.settings || {};
        store.data.settings.sources = store.data.settings.sources || {};
        store.data.settings.sources[key] = item.checked;
        store.save();
        refresh();
      },
    })) },
    { label: 'New note', click: newManualNote },
    { label: 'Source look-ahead', submenu: SOURCE_WINDOWS.map(sw => ({
      label: `${sw.label} — ${sourceWindow(sw)}d`,
      submenu: sw.choices.map(days => ({
        label: `${days} days${days === config[sw.key][sw.configKey] ? ' (default)' : ''}`,
        type: 'radio',
        checked: sourceWindow(sw) === days,
        click: () => {
          store.data.settings = store.data.settings || {};
          store.data.settings.sourceWindows = store.data.settings.sourceWindows || {};
          store.data.settings.sourceWindows[sw.key] = days;
          store.save();
          refresh();
        },
      })),
    })) },
    { label: 'Date filter', submenu: LOOKAHEAD_CHOICES.map(c => ({
      label: c.label,
      type: 'radio',
      checked: lookAheadDays() === c.value,
      click: () => {
        store.data.settings = store.data.settings || {};
        store.data.settings.lookAheadDays = c.value;
        store.save();
        syncWindows();
        buildTray();
      },
    })) },
    { type: 'separator' },
    { label: 'Pin all on top', click: () => setAllPinned(true) },
    { label: 'Send all to background', click: () => setAllPinned(false) },
    { label: 'Restack column', click: () => {
      for (const n of Object.values(store.notes)) delete n.userMoved;
      column.resetScroll();
      column.layoutStack();
    } },
    { label: 'Snap stops at column (edge guard)', type: 'checkbox', checked: edgeGuardEnabled(), click: item => {
      store.data.settings = store.data.settings || {};
      store.data.settings.edgeGuard = item.checked;
      store.save();
    } },
    { label: 'Reopen notes closed today', click: () => { store.undismissToday(); refresh(); } },
    { type: 'separator' },
    { label: 'App overview', click: () => openViewer(path.join(__dirname, 'OVERVIEW.md')) },
    { label: 'Quit Stickies', click: () => app.quit() },
  ]));
}

// ---- IPC ----

ipcMain.on('note:ready', e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const n = store.notes[win.noteId];
  if (n) e.sender.send('note:data', n);
});
ipcMain.on('note:height', (e, h) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win.isDestroyed()) return;
  const clamped = Math.max(NOTE.minHeight, Math.min(NOTE.maxHeight, Math.ceil(h)));
  if (win.getContentSize()[1] !== clamped) {
    win.setContentSize(NOTE.width, clamped);
    column.scheduleLayout(); // keep the column packed when a card grows or shrinks
  }
});
ipcMain.on('note:edit', (e, { id, text }) => {
  const n = store.notes[id];
  if (!n) return;
  n.text = text;
  n.userEdited = true;
  delete n.startEditing;
  store.save();
});
ipcMain.on('note:deadline', (e, { id, deadline }) => {
  const n = store.notes[id];
  if (!n) return;
  n.deadline = deadline || null;
  n.userDeadline = true;
  store.save();
  const win = wins.get(id);
  if (win && !win.isDestroyed()) win.webContents.send('note:data', n);
});
ipcMain.on('note:close', (e, id) => {
  store.dismiss(id);
  const win = wins.get(id);
  if (win) win.destroy();
  buildTray();
});
ipcMain.on('note:pin', (e, { id, pinned }) => {
  const n = store.notes[id];
  if (n) { n.pinned = pinned; store.save(); }
  const win = wins.get(id);
  if (win) {
    applyPinState(win, pinned);
    if (pinned) win.moveTop();
  }
});
ipcMain.on('note:openSource', (e, id) => {
  const n = store.notes[id];
  if (n && n.sourceFile) openViewer(n.sourceFile);
});
ipcMain.on('column:scroll', (e, dy) => column.scrollBy(dy));
ipcMain.on('column:step', (e, dir) => column.stepColumn(dir));

// Mark the item done AT THE SOURCE, then close the note. Per-source behavior
// is documented in OVERVIEW.md; failures resend note:data so the renderer's
// pending state resets and the card stays.
ipcMain.on('note:done', async (e, id) => {
  const n = store.notes[id];
  if (!n) return;
  const fail = (message, detail) => {
    dialog.showMessageBox({ type: 'error', message, detail: String(detail) });
    if (!e.sender.isDestroyed()) e.sender.send('note:data', n);
  };
  if (n.source === 'sticks') {
    try { await closeSticksTask(dbConfig('sticks'), n.sticksTaskId); }
    catch (err) { fail('Could not close the task in Sticks', err); return; }
  } else if (n.source === 'commit') {
    try { await fulfillCommitment(dbConfig('commit'), n.commitId, n.commitText); }
    catch (err) { fail('Could not fulfill the commitment', err); return; }
  } else if (n.source === 'feed') {
    try { await dismissAgentFeedItem(dbConfig('feed'), n.feedIds || n.feedId); }
    catch (err) { fail('Could not dismiss the feed item', err); return; }
  } else if (n.source === 'tax') {
    if (!n.dataFile) {
      fail('Dropbox canonical deadlines.json is unreachable.', 'The SSD copy is a read-only mirror, so the item was not marked done at the source. The note stays until Dropbox is back.');
      return;
    }
    try {
      const doc = JSON.parse(fs.readFileSync(n.dataFile, 'utf8'));
      const item = (doc.items || []).find(i => i.id === n.taxItemId);
      if (!item) throw new Error(`item ${n.taxItemId} not found`);
      item.done = true;
      item.note = `[closed ${todayPT()} by Justin via Stickies] ` + (item.note || '');
      fs.writeFileSync(n.dataFile, JSON.stringify(doc, null, 2) + '\n');
    } catch (err) {
      fail('Could not update deadlines.json', err);
      return;
    }
  } else if (n.source === 'primer' || n.source === 'kit') {
    store.addCompleted(n.text);
    // Best-effort strikethrough in today's file; suppression above is what
    // actually keeps it off the board.
    if (n.raw && n.sourceFile) {
      try {
        const content = fs.readFileSync(n.sourceFile, 'utf8');
        if (content.includes(n.raw)) {
          const struck = n.raw.replace(/^([-*]\s+|\d+\.\s+)?(.*)$/s, (m, p, rest) => `${p || ''}~~${rest}~~ ✅`);
          fs.writeFileSync(n.sourceFile, content.replace(n.raw, struck));
        }
      } catch { /* strikethrough is cosmetic; ignore */ }
    }
  }
  store.dismiss(id);
  const win = wins.get(id);
  if (win) win.destroy();
  buildTray();
});

// ---- lifecycle ----

// Second launches (login item re-fires, manual open while running) exit
// quietly instead of fighting the live instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // tray-only utility, no Dock icon
  store = new Store(app.getPath('userData'));
  refresh();
  setInterval(refresh, config.refreshMinutes * 60 * 1000);
  guard.start();
  // Monitor unplugged/rearranged → repack the column on the new geometry.
  screen.on('display-added', () => column.scheduleLayout());
  screen.on('display-removed', () => column.scheduleLayout());
  screen.on('display-metrics-changed', () => column.scheduleLayout());
});

app.on('before-quit', () => { if (store) store.save(); });
app.on('window-all-closed', () => { /* keep running in the tray */ });
