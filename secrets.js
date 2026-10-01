// Connector secrets (API tokens, private calendar addresses) are encrypted
// with the OS credential store via Electron safeStorage: Keychain on macOS,
// DPAPI on Windows. Stored as {enc: base64}. Where encryption is unavailable
// (some Linux desktops) the value is kept as plain text, flagged {plain}.
const { safeStorage } = require('electron');

function isSecretField(f) {
  return f.type === 'secret' || f.secret === true;
}

function seal(value) {
  if (value == null || value === '') return null;
  if (safeStorage.isEncryptionAvailable()) {
    return { enc: safeStorage.encryptString(String(value)).toString('base64') };
  }
  return { plain: String(value) };
}

function open(sealed) {
  if (sealed == null) return null;
  if (typeof sealed === 'string') return sealed;
  if (sealed.plain != null) return sealed.plain;
  try { return safeStorage.decryptString(Buffer.from(sealed.enc, 'base64')); }
  catch { return null; } // store copied from another machine or user account
}

/** Saved connector settings with secret fields decrypted, for ingest/done. */
function unsealSettings(connector, saved = {}) {
  const out = { ...saved };
  for (const f of connector.fields || []) if (isSecretField(f) && f.name in out) out[f.name] = open(out[f.name]);
  return out;
}

module.exports = { isSecretField, seal, open, unsealSettings };
