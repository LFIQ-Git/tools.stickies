// Guardrail tests: renderer navigation policy and the packaging allowlist
// that keeps private/ out of the installers.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { navTarget, openExternalSafe, ABOUT_LINK } = require('../navguard');
const pkg = require('../package.json');

test('navTarget sends https links to the browser', () => {
  assert.strictEqual(navTarget('https://example.com/a?b=1'), 'external');
});

test('navTarget blocks everything else a renderer tries to open', () => {
  for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)',
    'data:text/html,hi', 'mailto:a@b.c', 'not a url', '', undefined]) {
    assert.strictEqual(navTarget(url), 'block', String(url));
  }
});

test('About Left Field IQ tray item opens the About page in the browser', () => {
  assert.strictEqual(ABOUT_LINK.label, 'About Left Field IQ');
  assert.strictEqual(ABOUT_LINK.url, 'https://leftfieldiq.com/about');
  const opened = [];
  const shell = { openExternal: (u) => opened.push(u) };
  assert.strictEqual(openExternalSafe(shell, ABOUT_LINK.url), true);
  assert.strictEqual(openExternalSafe(shell, 'file:///etc/passwd'), false);
  assert.deepStrictEqual(opened, ['https://leftfieldiq.com/about']);
  const main = require('fs').readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /label: ABOUT_LINK\.label, click: \(\) => openExternalSafe\(shell, ABOUT_LINK\.url\)/);
});

test('build.files is an explicit allowlist that never ships private/', () => {
  const files = pkg.build.files;
  assert.ok(Array.isArray(files) && files.length > 0, 'build.files must be a non-empty list');
  for (const f of files) {
    assert.ok(!f.startsWith('!'), `exclusion patterns turn the list into a denylist: ${f}`);
    assert.ok(!/^\*\*?(\/|$)/.test(f), `top-level wildcard would include private/: ${f}`);
    const top = f.split('/')[0];
    assert.notStrictEqual(top, 'private', `private/ must never be packaged: ${f}`);
  }
});

test('every build.files entry points at something that exists', () => {
  const fs = require('fs');
  for (const f of pkg.build.files) {
    const p = path.join(__dirname, '..', f.replace(/\/\*\*$/, ''));
    assert.ok(fs.existsSync(p), `missing packaged path: ${f}`);
  }
});
