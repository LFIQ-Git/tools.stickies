// stickies.lfiq.app: the Stickies download page. Installers and the release
// manifest (latest.json) live in the R2 bucket bound as RELEASES; the page is
// rendered from that manifest, so publishing a release never needs a deploy.
//
//   GET /                 download page
//   GET /latest.json      release manifest
//   GET /download/<key>   installer from R2 (Range supported for resumes)

const MANIFEST = 'latest.json';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') return page(env);
    if (url.pathname === '/latest.json') {
      const m = await manifest(env);
      return m ? json(m) : json({ error: 'no release published yet' }, 404);
    }
    if (url.pathname.startsWith('/download/')) return download(request, env, decodeURIComponent(url.pathname.slice('/download/'.length)));
    return env.ASSETS.fetch(request);
  },
};

async function manifest(env) {
  const obj = await env.RELEASES.get(MANIFEST);
  return obj ? obj.json() : null;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

async function download(request, env, key) {
  // Only keys the manifest lists are served; nothing else in the bucket leaks.
  const m = await manifest(env);
  const file = m?.files?.find(f => f.key === key);
  if (!file) return new Response('Not found', { status: 404 });
  const obj = await env.RELEASES.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
  headers.set('Cache-Control', 'public, max-age=86400, immutable');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  let status = 200;
  if (obj.range && request.headers.has('Range')) {
    const { offset = 0, length = obj.size - offset } = obj.range;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    status = 206;
  } else {
    headers.set('Content-Length', String(obj.size));
  }
  return new Response(request.method === 'HEAD' ? null : obj.body, { status, headers });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = n => `${(n / 1048576).toFixed(0)} MB`;

async function page(env) {
  const m = await manifest(env);
  const files = m?.files || [];
  const pick = (os, arch) => files.find(f => f.os === os && f.arch === arch);
  const macArm = pick('mac', 'arm64'), macIntel = pick('mac', 'x64'), win = pick('windows', 'x64');
  const btn = (f, label, sub, id) => f
    ? `<a class="dl" id="${id}" href="/download/${encodeURI(f.key)}" download>
         <span class="dl-label">${esc(label)}</span><span class="dl-sub">${esc(sub)} · ${mb(f.size)}</span></a>`
    : '';
  const sums = files.map(f => `<tr><td>${esc(f.key.split('/').pop())}</td><td><code>${esc(f.sha256)}</code></td></tr>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stickies</title>
<meta name="description" content="Always-on-top sticky notes for today's to-dos, for Mac and Windows.">
<link rel="icon" href="/favicon.png">
<style>
  :root {
    --canvas: #fdfaf4; --surface: #ffffff; --text: #242220; --muted: #706d68; --heading: #092440;
    --primary: #173454; --primary-hover: #38597e; --on-primary: #ffffff; --accent: #4d80b5;
    --border: #e7e3de; --subtle: #f5f0e9; --link: #38597e;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --canvas: #0f1720; --surface: #16212d; --text: #e6e4e0; --muted: #a7a39c; --heading: #e6effa;
      --primary: #b1c9e4; --primary-hover: #cfdff2; --on-primary: #092440; --accent: #7eaddf;
      --border: #2a3644; --subtle: #1b2836; --link: #a6caf1;
    }
  }
  :root[data-theme="dark"] {
    --canvas: #0f1720; --surface: #16212d; --text: #e6e4e0; --muted: #a7a39c; --heading: #e6effa;
    --primary: #b1c9e4; --primary-hover: #cfdff2; --on-primary: #092440; --accent: #7eaddf;
    --border: #2a3644; --subtle: #1b2836; --link: #a6caf1;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--text);
         font: 16px/1.55 Inter, -apple-system, "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 48px 16px 80px; }
  header { display: flex; gap: 20px; align-items: center; margin-bottom: 28px; }
  header img { width: 88px; height: 88px; flex: none; }
  h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 6px; color: var(--heading); }
  h2 { font-size: 22px; letter-spacing: -0.01em; color: var(--heading); margin: 40px 0 12px; }
  h3 { font-size: 16px; margin: 0 0 6px; color: var(--heading); }
  .lede { color: var(--muted); margin: 0; font-size: 18px; }
  .version { color: var(--muted); font-size: 14px; margin-top: 4px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px;
           box-shadow: 0 1px 2px rgba(9,36,64,.05), 0 6px 20px rgba(9,36,64,.06); }
  .panel.mine { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent); }
  .dl { display: block; text-decoration: none; background: var(--primary); color: var(--on-primary);
        border-radius: 10px; padding: 12px 14px; margin-top: 10px; }
  .dl:hover { background: var(--primary-hover); }
  .dl:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  .dl-label { display: block; font-weight: 600; }
  .dl-sub { display: block; font-size: 13px; opacity: .85; }
  .mine-tag { font-size: 12px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: .06em; }
  ol, ul { padding-left: 1.3em; } li { margin: .35em 0; }
  .note { background: var(--subtle); border-radius: 10px; padding: 12px 14px; font-size: 14px; color: var(--text); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px 6px; border-top: 1px solid var(--border); vertical-align: top; }
  td:first-child { white-space: nowrap; padding-right: 14px; }
  code { font: 12px ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
  .table-wrap { overflow-x: auto; }
  a { color: var(--link); }
  .src { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .src div { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; font-size: 14px; }
  .src b { display: block; color: var(--heading); }
  footer { margin-top: 56px; color: var(--muted); font-size: 13px; }
  @media (max-width: 560px) { h1 { font-size: 32px; } header { align-items: flex-start; } header img { width: 64px; height: 64px; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="/icon-256.png" alt="" width="88" height="88">
    <div>
      <h1>Stickies</h1>
      <p class="lede">Today's to-dos as sticky notes that stay on top of every window. Check one off and it is marked done where it came from.</p>
      ${m ? `<p class="version">Version ${esc(m.version)} · released ${esc(m.released)}</p>` : ''}
    </div>
  </header>

  ${m ? `<div class="grid">
    <section class="panel" id="p-mac">
      <span class="mine-tag" hidden>For this computer</span>
      <h3>Mac</h3>
      <div class="dl-sub" style="color:var(--muted)">macOS 12 or later</div>
      ${btn(macArm, 'Download for Apple silicon', 'M1 and later', 'dl-mac-arm')}
      ${btn(macIntel, 'Download for Intel Mac', 'Older Macs', 'dl-mac-intel')}
    </section>
    <section class="panel" id="p-win">
      <span class="mine-tag" hidden>For this computer</span>
      <h3>Windows</h3>
      <div class="dl-sub" style="color:var(--muted)">Windows 10 or 11, 64-bit</div>
      ${btn(win, 'Download for Windows', 'Installer', 'dl-win')}
    </section>
  </div>` : `<p class="note">No release has been published yet.</p>`}

  <h2>Install</h2>
  <div class="grid">
    <section class="panel">
      <h3>Mac</h3>
      <ol>
        <li>Open the downloaded .dmg and drag <b>Stickies</b> into Applications.</li>
        <li>Open Stickies from Applications. macOS will say it cannot verify the developer. Click <b>Done</b>.</li>
        <li>Open <b>System Settings → Privacy &amp; Security</b>, scroll down, and click <b>Open Anyway</b> next to Stickies. Confirm once more.</li>
        <li>Look for the 🗒 in the menu bar. Stickies opens its Settings the first time.</li>
      </ol>
    </section>
    <section class="panel">
      <h3>Windows</h3>
      <ol>
        <li>Run the downloaded installer.</li>
        <li>If Windows shows "Windows protected your PC", click <b>More info</b>, then <b>Run anyway</b>.</li>
        <li>Pick where to install and finish. Stickies starts and opens its Settings.</li>
        <li>The Stickies icon lives in the system tray (click ^ by the clock if it is hidden).</li>
      </ol>
    </section>
  </div>
  <p class="note">The installers are not yet signed with an Apple or Microsoft developer certificate, which is why the extra step appears. You can confirm a download is intact against the SHA-256 checksums below.</p>

  <h2>Where your to-dos come from</h2>
  <div class="src">
    <div><b>Any calendar</b>Google, Outlook or iCloud through the calendar's private iCal link. Today's remaining meetings.</div>
    <div><b>Todoist</b>Tasks matching your filter. Checking a note completes the task.</div>
    <div><b>Apple Reminders</b>On Mac. Checking a note completes the reminder.</div>
    <div><b>Markdown checklists</b>Open "- [ ]" tasks from Obsidian, Logseq or any notes file. Checking a note ticks the box.</div>
    <div><b>todo.txt</b>Open lines from a todo.txt file. Checking a note completes the line.</div>
    <div><b>Your own notes</b>Add a note from the tray menu at any time.</div>
  </div>
  <p style="color:var(--muted);font-size:14px">Tokens and calendar links are stored encrypted on your computer. Stickies talks only to the sources you turn on. There is no Stickies account and no tracking.</p>

  ${sums ? `<h2>Checksums (SHA-256)</h2><div class="table-wrap"><table>${sums}</table></div>` : ''}

  <footer>Left Field Investments LLC · <a href="/latest.json">Release manifest</a></footer>
</div>
<script>
  (function () {
    var ua = navigator.userAgent || '';
    var plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    var isWin = /Win/i.test(plat) || /Windows/i.test(ua);
    var isMac = !isWin && (/Mac/i.test(plat) || /Mac OS X/i.test(ua)) && !/iPhone|iPad/i.test(ua);
    var el = document.getElementById(isWin ? 'p-win' : isMac ? 'p-mac' : '');
    if (el) { el.classList.add('mine'); el.querySelector('.mine-tag').hidden = false; }
  })();
</script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
