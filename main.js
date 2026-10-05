// Stickies main process: note windows, tray, refresh pipeline, IPC.
// Sources are connectors (connectors/index.js documents the contract); the
// column layout engine lives in layout.js, the macOS edge guard in guard.js,
// the markdown viewer in viewer.js, the Settings window in settings.js.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const Store = require('./store');
const { loadConnectors, resolveConfig } = require('./connectors');
const { todayLocal, daysUntil } = require('./connectors/util');
const { unsealSettings } = require('./secrets');
const { createColumn } = require('./layout');
const { createGuard } = require('./guard');
const { openViewer } = require('./viewer');
const { openSettings, registerSettingsIpc } = require('./settings');
const { installNavGuard, openExternalSafe, ABOUT_LINK } = require('./navguard');
const config = require('./config.json');

const IS_MAC = process.platform === 'darwin';
const INGEST_TIMEOUT_MS = 45000;

let store;
let tray;
/** @type {{list: object[], byKey: Map<string, object>, errors: string[]}} */
let registry = { list: [], byKey: new Map(), errors: [] };
/** @type {Map<string, Electron.BrowserWindow>} note id -> window */
const wins = new Map();
let lastIngestErrors = [];
let refreshTimer;

const NOTE = config.note;

// ---- settings ----

function settings() {
  store.data.settings = store.data.settings || {};
  return store.data.settings;
}

function savedFor(key) {
  const s = settings();
  s.connectors = s.connectors || {};
  return s.connectors[key] || {};
}

function connectorEnabled(c) {
  if (c.key === 'manual') return true;
  const v = savedFor(c.key).enabled;
  return v === undefined ? !!c.defaultEnabled : v;
}

/** Effective config for a connector: defaults + saved settings, secrets decrypted. */
function cfgFor(c) {
  return resolveConfig(c, unsealSettings(c, savedFor(c.key)));
}

function refreshMinutes() {
  return Number(settings().refreshMinutes) || config.refreshMinutes;
}

/** Folders that extra connectors load from. */
function extraConnectorDirs() {
  const dirs = [];
  // A source checkout may carry private connectors; the packaged app never does.
  if (!app.isPackaged) dirs.push(path.join(__dirname, 'private'));
  if (settings().customConnectorDir) dirs.push(settings().customConnectorDir);
  return dirs;
}

function reloadConnectors() {
  registry = loadConnectors({ extraDirs: extraConnectorDirs() });
  store.expireDays = Object.fromEntries(registry.list.filter(c => c.expireDays).map(c => [c.key, c.expireDays]));
}

// Pre-connector stores kept toggles in settings.sources and windows in
// settings.sourceWindows; fold them into settings.connectors once.
function migrateSettings() {
  const s = settings();
  if (!s.sources && !s.sourceWindows) return;
  s.connectors = s.connectors || {};
  for (const [key, on] of Object.entries(s.sources || {})) {
    s.connectors[key] = { ...(s.connectors[key] || {}), enabled: on };
  }
  for (const [key, days] of Object.entries(s.sourceWindows || {})) {
    const c = registry.byKey.get(key);
    if (c?.window) s.connectors[key] = { ...(s.connectors[key] || {}), [c.window.field]: days };
  }
  delete s.sources;
  delete s.sourceWindows;
  store.save();
}

/** Display order for the column: connector order, then start time / id. */
function notesOrdered() {
  const rank = key => registry.byKey.get(key)?.order ?? 900;
  return Object.values(store.notes).sort((a, b) => {
    const s = rank(a.source) - rank(b.source);
    if (s !== 0) return s;
    const t = (a.sortKey ?? 0) - (b.sortKey ?? 0);
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

const column = createColumn({ note: NOTE, wins, notesOrdered });

// Date filter: cards whose deadline is more than N days ahead are hidden.
// Past due and today always show; undated cards always show. null = no limit.
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
  const v = settings().lookAheadDays;
  return v === undefined ? null : v;
}

/** @param {import('./types').Note} n */
function noteVisible(n) {
  const la = lookAheadDays();
  if (la == null || !n.deadline) return true;
  return daysUntil(n.deadline) <= la;
}

/** The note plus what the renderer needs from its connector. */
function forRenderer(n) {
  const c = registry.byKey.get(n.source);
  return {
    ...n,
    color: c?.color || '#C9F2C7',
    chip: c?.chip || n.source,
    canDone: n.source === 'manual' || !!c?.done,
    hasSource: !!(n.sourceFile || n.sourceUrl),
  };
}

function sendNote(win, n) {
  if (n && win && !win.isDestroyed()) win.webContents.send('note:data', forRenderer(n));
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
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/** Run every enabled connector concurrently; one failing never blocks the rest. */
async function ingestAll() {
  const active = registry.list.filter(c => c.key !== 'manual' && connectorEnabled(c));
  const ctx = { store, todayLocal };
  const results = await Promise.all(active.map(async c => {
    try {
      const r = await withTimeout(Promise.resolve(c.ingest(cfgFor(c), ctx)), INGEST_TIMEOUT_MS, c.label);
      return { c, notes: (r?.notes || []).map(n => ({ ...n, source: c.key })), error: r?.error };
    } catch (e) {
      return { c, notes: [], error: e.message };
    }
  }));
  return results;
}

let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  setTrayBusy(true);
  try { await doRefresh(); }
  catch (e) { console.error('[refresh]', e); }
  finally {
    refreshing = false;
    setTrayBusy(false);
  }
}

async function doRefresh() {
  const results = await ingestAll();
  lastIngestErrors = [
    ...registry.errors.map(e => `connector load: ${e}`),
    ...results.filter(r => r.error).map(r => `${r.c.label}: ${r.error}`),
  ];

  // The same item often shows up in several feeds. Derivative connectors drop
  // notes that fuzzy-match anything kept before them (connector order).
  const kept = [];
  for (const { c, notes } of results) {
    for (const n of notes) {
      if (c.derivative) {
        const a = Store.wordSet(n.summary || n.text);
        const dup = kept.some(o => {
          if (c.dedupeWithinSource === false && o.source === n.source) return false;
          const b = Store.wordSet(o.text);
          let inter = 0;
          for (const w of a) if (b.has(w)) inter++;
          return a.size > 0 && inter / Math.min(a.size, b.size || 1) >= 0.6;
        });
        if (dup) continue;
      }
      kept.push(n);
    }
  }
  for (const n of kept) {
    if (store.isDismissed(n.id)) continue;
    if (registry.byKey.get(n.source)?.suppressByContent && store.isCompleted(n.text)) continue;
    store.upsert(n);
  }

  // Live connectors: a card missing from a clean refresh was closed elsewhere
  // or is over. Skipped when that connector errored, so an outage never wipes
  // the board.
  const seen = new Set(kept.map(n => n.id));
  const cleanLive = new Set(results.filter(r => r.c.live && !r.error).map(r => r.c.key));
  // Narrowing a look-ahead window retro-removes cards beyond it.
  const windowOf = new Map(registry.list
    .filter(c => c.window && c.window.retroRemove !== false)
    .map(c => [c.key, cfgFor(c)[c.window.field]]));

  for (const [id, n] of Object.entries(store.notes)) {
    if (n.source === 'manual' || n.userEdited) continue;
    const c = registry.byKey.get(n.source);
    // Turned off, or no longer installed: its cards go with it.
    if (!c || !connectorEnabled(c)) { delete store.notes[id]; continue; }
    if (cleanLive.has(n.source) && !seen.has(id)) { delete store.notes[id]; continue; }
    const w = windowOf.get(n.source);
    if (w != null && n.deadline && daysUntil(n.deadline) > w) delete store.notes[id];
  }
  store.prune();
  store.save();
  syncWindows();
  for (const [id, win] of wins) sendNote(win, store.notes[id]);
  buildTray();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, refreshMinutes() * 60 * 1000);
}

function newManualNote() {
  const id = `manual:${Date.now()}`;
  store.notes[id] = {
    id,
    source: 'manual',
    text: '',
    deadline: null,
    sourceFile: null,
    createdDate: todayLocal(),
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
    sendNote(win, n);
  }
  store.save();
}

// ---- edge guard (macOS only: it scripts other apps via Accessibility) ----

function edgeGuardEnabled() { return IS_MAC && settings().edgeGuard !== false; }

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

function trayImage() {
  if (IS_MAC) return nativeImage.createEmpty(); // the menu bar shows the 🗒 title instead
  return nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
}

function setTrayBusy(busy) {
  if (!tray) return;
  if (IS_MAC) tray.setTitle(busy ? '⟳' : '🗒');
  tray.setToolTip(busy ? 'Stickies: refreshing…' : 'Stickies');
}

function updateSetting(key, value) {
  settings()[key] = value;
  store.save();
}

function setConnectorValue(key, field, value) {
  const s = settings();
  s.connectors = s.connectors || {};
  s.connectors[key] = { ...(s.connectors[key] || {}), [field]: value };
  store.save();
}

function buildTray() {
  if (!tray) {
    tray = new Tray(trayImage());
    setTrayBusy(false);
    // Windows opens tray menus on right-click only; make left-click work too.
    if (!IS_MAC) tray.on('click', () => tray.popUpContextMenu());
  }
  const count = Object.keys(store.notes).length;
  const errLines = lastIngestErrors.map(e => ({ label: `⚠ ${e}`.slice(0, 110), enabled: false }));
  const guardError = guard.getError();
  if (guardError && /assistive|not allowed|1002|1743/i.test(guardError)) {
    errLines.push({ label: '⚠ Edge guard needs Accessibility + Automation for Stickies', enabled: false });
    errLines.push({ label: '   (System Settings → Privacy & Security)', enabled: false });
  }
  const sources = registry.list.filter(c => c.key !== 'manual');
  const windowed = sources.filter(c => c.window && connectorEnabled(c));
  const template = [
    { label: `${count} note${count === 1 ? '' : 's'}`, enabled: false },
    ...errLines,
    { type: 'separator' },
    { label: 'Refresh now', click: refresh },
    { label: 'New note', click: newManualNote },
    { label: 'Sources', submenu: [
      ...sources.map(c => ({
        label: c.label,
        type: 'checkbox',
        checked: connectorEnabled(c),
        click: item => { setConnectorValue(c.key, 'enabled', item.checked); refresh(); },
      })),
      { type: 'separator' },
      { label: 'Connect sources…', click: () => openSettings() },
    ] },
  ];
  if (windowed.length) {
    template.push({ label: 'Source look-ahead', submenu: windowed.map(c => {
      const current = cfgFor(c)[c.window.field];
      return {
        label: `${c.window.label} — ${current}d`,
        submenu: c.window.choices.map(days => ({
          label: `${days === 0 ? 'Today only' : `${days} days`}${days === c.window.default ? ' (default)' : ''}`,
          type: 'radio',
          checked: current === days,
          click: () => { setConnectorValue(c.key, c.window.field, days); refresh(); },
        })),
      };
    }) });
  }
  template.push(
    { label: 'Date filter', submenu: LOOKAHEAD_CHOICES.map(c => ({
      label: c.label,
      type: 'radio',
      checked: lookAheadDays() === c.value,
      click: () => { updateSetting('lookAheadDays', c.value); syncWindows(); buildTray(); },
    })) },
    { type: 'separator' },
    { label: 'Pin all on top', click: () => setAllPinned(true) },
    { label: 'Send all to background', click: () => setAllPinned(false) },
    { label: 'Restack column', click: () => {
      for (const n of Object.values(store.notes)) delete n.userMoved;
      column.resetScroll();
      column.layoutStack();
    } },
  );
  if (IS_MAC) {
    template.push({ label: 'Snap windows at column (edge guard)', type: 'checkbox', checked: edgeGuardEnabled(),
      click: item => updateSetting('edgeGuard', item.checked) });
  }
  template.push({ label: 'Reopen notes closed today', click: () => { store.undismissToday(); refresh(); } });
  template.push({ type: 'separator' });
  if (app.isPackaged) {
    template.push({ label: 'Start at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) });
  }
  template.push(
    { label: 'Settings…', click: () => openSettings() },
    { label: 'How Stickies works', click: () => openViewer(path.join(__dirname, 'OVERVIEW.md')) },
    { label: ABOUT_LINK.label, click: () => openExternalSafe(shell, ABOUT_LINK.url) },
    { label: `Quit Stickies${app.isPackaged ? '' : ' (dev)'}`, click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ---- IPC ----

ipcMain.on('note:ready', e => {
  const win = BrowserWindow.fromWebContents(e.sender);
  sendNote(win, store.notes[win.noteId]);
});
ipcMain.on('note:height', (e, h) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
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
  sendNote(wins.get(id), n);
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
  if (!n) return;
  if (n.sourceUrl && /^https:\/\//.test(n.sourceUrl)) shell.openExternal(n.sourceUrl);
  else if (n.sourceFile) openViewer(n.sourceFile);
});
ipcMain.on('column:scroll', (e, dy) => column.scrollBy(dy));
ipcMain.on('column:step', (e, dir) => column.stepColumn(dir));

// Mark the item done AT THE SOURCE, then close the note. A connector without
// done() (read-only, e.g. calendars) just dismisses. On failure the note
// stays and note:data resets the renderer's pending state.
ipcMain.on('note:done', async (e, id) => {
  const n = store.notes[id];
  if (!n) return;
  const c = registry.byKey.get(n.source);
  if (c?.done) {
    try {
      await c.done(n, cfgFor(c), { store, todayLocal });
    } catch (err) {
      dialog.showMessageBox({ type: 'error', message: `Could not mark this done in ${c.label}`, detail: String(err?.message || err) });
      if (!e.sender.isDestroyed()) e.sender.send('note:data', forRenderer(n));
      return;
    }
  }
  store.dismiss(id);
  const win = wins.get(id);
  if (win) win.destroy();
  buildTray();
});

registerSettingsIpc({
  getStore: () => store,
  getRegistry: () => registry,
  connectorEnabled,
  cfgFor,
  onSaved: ({ connectorsChanged }) => {
    if (connectorsChanged) reloadConnectors();
    scheduleRefresh();
    refresh();
  },
  ctx: () => ({ store, todayLocal }),
});

// ---- lifecycle ----

// A separate profile for testing next to a running copy.
if (process.env.STICKIES_USER_DATA) app.setPath('userData', process.env.STICKIES_USER_DATA);

// Second launches (login item re-fires, manual open while running) hand off
// to the live instance instead of fighting it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
}

if (process.platform === 'win32') app.setAppUserModelId('app.lfiq.stickies');

installNavGuard(app, shell);

app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // tray-only utility, no Dock icon
  store = new Store(app.getPath('userData'));
  reloadConnectors();
  migrateSettings();
  buildTray();
  refresh();
  scheduleRefresh();
  guard.start();
  // First run with nothing connected: open Settings so the app isn't silent.
  const anyEnabled = registry.list.some(c => c.key !== 'manual' && connectorEnabled(c));
  if (!anyEnabled && !settings().welcomed) {
    updateSetting('welcomed', true);
    openSettings();
  }
  // Monitor unplugged/rearranged → repack the column on the new geometry.
  screen.on('display-added', () => column.scheduleLayout());
  screen.on('display-removed', () => column.scheduleLayout());
  screen.on('display-metrics-changed', () => column.scheduleLayout());
});

app.on('before-quit', () => { if (store) store.save(); });
app.on('window-all-closed', () => { /* keep running in the tray */ });
