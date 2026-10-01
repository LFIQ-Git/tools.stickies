// Settings window: connect sources, set connector options, general options.
// Secret values never travel to the renderer; it only learns whether one is
// saved, and sends a new value (or an explicit clear) back.
const { BrowserWindow, ipcMain, dialog, app } = require('electron');
const path = require('path');
const { isSecretField, seal } = require('./secrets');
const { resolveConfig } = require('./connectors');

let win = null;

function openSettings() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 520,
    minHeight: 480,
    title: 'Stickies Settings',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'settings.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function registerSettingsIpc({ getStore, getRegistry, connectorEnabled, cfgFor, onSaved, ctx }) {
  const settings = () => {
    const store = getStore();
    store.data.settings = store.data.settings || {};
    return store.data.settings;
  };

  ipcMain.handle('settings:get', () => {
    const s = settings();
    const { list, errors } = getRegistry();
    return {
      platform: process.platform,
      version: app.getVersion(),
      packaged: app.isPackaged,
      loadErrors: errors,
      general: {
        refreshMinutes: s.refreshMinutes || 15,
        customConnectorDir: s.customConnectorDir || '',
      },
      connectors: list.filter(c => c.key !== 'manual').map(c => {
        const saved = (s.connectors || {})[c.key] || {};
        const values = {};
        const effective = resolveConfig(c, saved);
        for (const f of c.fields || []) {
          values[f.name] = isSecretField(f) ? { saved: saved[f.name] != null } : effective[f.name];
        }
        return {
          key: c.key,
          label: c.label,
          description: c.description || '',
          color: c.color,
          builtIn: !!c.builtIn,
          enabled: connectorEnabled(c),
          fields: (c.fields || []).map(f => ({ ...f, secret: isSecretField(f) })),
          values,
        };
      }),
    };
  });

  // payload: {general:{...}, connectors:{key:{enabled, values:{name: value | {clear:true}}}}}
  ipcMain.handle('settings:save', (e, payload) => {
    const s = settings();
    const store = getStore();
    const { byKey } = getRegistry();
    s.connectors = s.connectors || {};
    for (const [key, incoming] of Object.entries(payload.connectors || {})) {
      const c = byKey.get(key);
      if (!c) continue;
      const next = { ...(s.connectors[key] || {}), enabled: !!incoming.enabled };
      for (const f of c.fields || []) {
        if (!(f.name in (incoming.values || {}))) continue;
        const v = incoming.values[f.name];
        if (isSecretField(f)) {
          if (v && v.clear) delete next[f.name];
          else if (typeof v === 'string' && v.trim()) next[f.name] = seal(v.trim());
        } else if (f.type === 'number') {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) next[f.name] = n;
        } else if (f.type === 'boolean') {
          next[f.name] = !!v;
        } else {
          next[f.name] = v;
        }
      }
      s.connectors[key] = next;
    }
    const g = payload.general || {};
    const mins = Number(g.refreshMinutes);
    if (Number.isFinite(mins) && mins >= 1 && mins <= 240) s.refreshMinutes = Math.round(mins);
    const prevDir = s.customConnectorDir || '';
    s.customConnectorDir = (g.customConnectorDir || '').trim() || undefined;
    store.save();
    onSaved({ connectorsChanged: prevDir !== (s.customConnectorDir || '') });
    return { ok: true };
  });

  // Try a connector with the form's current (unsaved) values. Secrets typed
  // into the form are used as-is; untouched secret fields fall back to saved.
  ipcMain.handle('settings:test', async (e, { key, values }) => {
    const { byKey } = getRegistry();
    const c = byKey.get(key);
    if (!c) return { error: 'unknown source' };
    const base = cfgFor(c);
    const cfg = { ...base };
    for (const f of c.fields || []) {
      if (!(f.name in (values || {}))) continue;
      const v = values[f.name];
      if (isSecretField(f)) {
        if (v && v.clear) cfg[f.name] = null;
        else if (typeof v === 'string' && v.trim()) cfg[f.name] = v.trim();
      } else cfg[f.name] = f.type === 'number' ? Number(v) : v;
    }
    try {
      const r = await c.ingest(cfg, ctx());
      const notes = r?.notes || [];
      return { count: notes.length, error: r?.error, sample: notes.slice(0, 5).map(n => n.summary || n.text) };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('settings:pickFile', async (e, { multi, extensions }) => {
    const r = await dialog.showOpenDialog(win, {
      properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: extensions ? [{ name: 'Task files', extensions }, { name: 'All files', extensions: ['*'] }] : undefined,
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('settings:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
}

module.exports = { openSettings, registerSettingsIpc };
