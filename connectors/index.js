// Connector registry. A connector is a plain module:
//
//   key, label, chip, color, order     identity and card styling
//   description, fields[]              rendered by the Settings window
//   platforms?                         e.g. ['darwin']; hidden elsewhere
//   window?  {field, label, choices, default}
//                                      look-ahead knob shown in the tray;
//                                      cards dated past it are removed
//   live?                              cards missing from a clean refresh are
//                                      removed (closed elsewhere, meeting over)
//   derivative?                        fuzzy-deduped against other sources
//   suppressByContent?                 skip notes whose text matches an item
//                                      closed earlier (date-scoped ids)
//   expireDays?                        untouched cards older than this go
//   defaultEnabled?                    on until the user turns it off
//   defaults?                          base config merged under user settings
//   ingest(cfg, ctx) -> {notes, error?}
//   done?(note, cfg, ctx)              mark done at the source; throw to refuse
//
// Built-ins ship with the app. Extra connectors load from any folder of .js
// modules exporting one connector or an array (Settings → Custom connectors),
// and from ./private when running from a source checkout that has one.
const fs = require('fs');
const path = require('path');

const BUILT_IN = [
  require('./ics'),
  require('./todoist'),
  require('./reminders'),
  require('./markdown'),
  require('./todotxt'),
];

const MANUAL = { key: 'manual', label: 'Your notes', chip: 'Note', color: '#C9F2C7', order: 1000, builtIn: true };

/** Load connector modules from a folder; problems are returned, never thrown. */
function loadDir(dir) {
  const found = [];
  const errors = [];
  if (!dir || !fs.existsSync(dir)) return { found, errors };
  // A folder with an index.js is one package: load only its entry point, so
  // helper modules and scratch scripts beside it never run.
  const names = fs.existsSync(path.join(dir, 'index.js')) ? ['index.js'] : fs.readdirSync(dir).sort();
  for (const f of names) {
    if (!f.endsWith('.js')) continue;
    const file = path.join(dir, f);
    try {
      const mod = require(file);
      for (const c of [].concat(mod.connectors || mod)) {
        if (c && typeof c.key === 'string' && typeof c.ingest === 'function') found.push({ ...c, file });
      }
    } catch (e) {
      errors.push(`${f}: ${e.message}`);
    }
  }
  return { found, errors };
}

/**
 * @param {{extraDirs?: string[], platform?: string}} opts
 * @returns {{list: object[], byKey: Map<string, object>, errors: string[]}}
 */
function loadConnectors({ extraDirs = [], platform = process.platform } = {}) {
  const byKey = new Map();
  const errors = [];
  for (const c of BUILT_IN) byKey.set(c.key, { ...c, builtIn: true });
  for (const dir of extraDirs) {
    const { found, errors: errs } = loadDir(dir);
    errors.push(...errs);
    for (const c of found) {
      if (c.key === 'manual') { errors.push(`${path.basename(c.file)}: "manual" is reserved`); continue; }
      byKey.set(c.key, c);
    }
  }
  byKey.set('manual', MANUAL);
  const list = [...byKey.values()]
    .filter(c => !c.platforms || c.platforms.includes(platform))
    .sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
  return { list, byKey: new Map(list.map(c => [c.key, c])), errors };
}

/** Field defaults → connector defaults → saved settings. */
function resolveConfig(connector, saved = {}) {
  const cfg = {};
  for (const f of connector.fields || []) if (f.default !== undefined) cfg[f.name] = f.default;
  if (connector.window) cfg[connector.window.field] = connector.window.default;
  return { ...cfg, ...(connector.defaults || {}), ...saved };
}

module.exports = { loadConnectors, resolveConfig, BUILT_IN, MANUAL };
