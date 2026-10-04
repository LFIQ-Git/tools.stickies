// Renderer navigation policy. Card, Settings, arrow and viewer windows only
// ever show pages the main process loads; a renderer never navigates itself
// or opens new windows. A clicked https link (for example inside a Markdown
// source in the viewer) goes to the default browser instead.

/**
 * Decide what to do with a URL a renderer tried to navigate to or open.
 * @param {string|undefined} url
 * @returns {'external'|'block'}
 */
function navTarget(url) {
  let u;
  try { u = new URL(String(url)); } catch { return 'block'; }
  return u.protocol === 'https:' ? 'external' : 'block';
}

/**
 * Apply the policy to every web contents the app creates.
 * @param {import('electron').App} app
 * @param {import('electron').Shell} shell
 */
function installNavGuard(app, shell) {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (navTarget(url) === 'external') shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      e.preventDefault();
      if (navTarget(url) === 'external') shell.openExternal(url);
    });
  });
}

module.exports = { navTarget, installNavGuard };
