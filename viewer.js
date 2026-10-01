// Formatted markdown viewer — a plain resizable window, not always-on-top.
// Non-markdown source files fall back to the OS default app. A CSP in the
// generated page blocks all script execution: source files are data, not code.
const { BrowserWindow, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const CSS = `
  body{font:15px/1.6 -apple-system,"SF Pro Text","Segoe UI",Helvetica,sans-serif;color:#24292f;background:#fff;
    max-width:780px;margin:0 auto;padding:32px 40px 80px}
  h1,h2,h3{line-height:1.25;margin:1.2em 0 .5em;padding-bottom:.25em}
  h1{font-size:1.7em;border-bottom:1px solid #d8dee4}h2{font-size:1.3em;border-bottom:1px solid #d8dee4}h3{font-size:1.1em}
  p,ul,ol{margin:.6em 0}li{margin:.25em 0}ul,ol{padding-left:1.6em}
  code{font:.9em ui-monospace,Menlo,monospace;background:#f6f8fa;padding:.15em .35em;border-radius:4px}
  pre{background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto}pre code{background:none;padding:0}
  table{border-collapse:collapse;margin:.8em 0}th,td{border:1px solid #d8dee4;padding:5px 10px}th{background:#f6f8fa}
  blockquote{border-left:4px solid #d8dee4;margin:.8em 0;padding:0 1em;color:#57606a}
  del{color:#8b949e}hr{border:0;border-top:1px solid #d8dee4;margin:1.5em 0}
  a{color:#0969da;text-decoration:none}a:hover{text-decoration:underline}
  .src{font-size:11px;color:#8b949e;margin-bottom:16px;font-family:ui-monospace,Menlo,monospace}
  @media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}
    h1,h2{border-color:#30363d}code,pre,th{background:#161b22}th,td,blockquote,hr{border-color:#30363d}}`;

/** @param {string} s */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Open `file` in the formatted viewer (markdown) or the OS default app
 * (anything else). Read failures log and no-op.
 * @param {string} file absolute path
 */
function openViewer(file) {
  let md;
  try { md = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    console.error('[viewer] could not read', file, String(err));
    return;
  }
  if (!/\.md$/i.test(file)) { shell.openPath(file); return; }
  const body = marked.parse(md);
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>${esc(path.basename(file))}</title><style>${CSS}</style></head>
  <body><div class="src">${esc(file)}</div>${body}</body></html>`;
  const win = new BrowserWindow({ width: 820, height: 900, title: path.basename(file), autoHideMenuBar: true });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

module.exports = { openViewer };
