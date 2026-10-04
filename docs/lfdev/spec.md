# Stickies spec

## As built, 2026-10-03

### Architecture
- Electron 44 main process (`main.js`) owns the tray, refresh loop, note windows and IPC. Each card is its own frameless `BrowserWindow` loading `note.html` with `preload.js` and `contextIsolation: true`; Electron's default renderer sandbox applies and `nodeIntegration` is off by default.
- `layout.js` packs cards in one column flush right and draws step arrows (`arrow.html`). `guard.js` is the optional macOS edge guard that nudges other app windows off the column (needs Accessibility and Automation permission).
- `viewer.js` renders a source Markdown file with `marked` into a `data:` URL page whose CSP blocks all scripts. Non-Markdown sources open with the OS default app (`shell.openPath`).
- `settings.js`, `settings.html`, `settings-page.js` and `preload-settings.js` are the Settings window.
- `store.js` persists state; `secrets.js` seals connector secrets with Electron `safeStorage`.
- `site/` is a Cloudflare Worker (`stickies-downloads`) serving the download page, `latest.json` and installers from R2 bucket `stickies-releases`.

### Data model
One JSON file, `<userData>/stickies-store.json`: `notes` (stable ids such as `tax:<id>`, `primer:<date>:<hash>`), `dismissed` (pruned at 45 days), `completed` (content suppression, 90 days), `settings.connectors.<key>` with sealed secrets. A corrupt file is backed up rather than wiped (`test/unit.test.js`). Note shape is in `types.js`.

### IPC
Note windows send `note:ready`, `note:height`, `note:edit`, `note:deadline`, `note:close`, `note:pin`, `note:openSource`, `note:done`, `column:scroll`, `column:step` (`main.js` 469-530). Settings uses `settings:get`, `settings:save`, `settings:test`, `settings:pickFile`, `settings:pickDir` (`settings.js`).

### Integrations
| Connector | Auth | Write-back | Failure handling |
|---|---|---|---|
| ics | feed URL | none | error shown in tray menu, other sources continue |
| todoist | personal token (sealed) | closes task via API v1 | same |
| reminders | macOS Automation (JXA) | completes reminder | same; macOS only |
| markdown | file path | ticks the checkbox | same |
| todotxt | file path | marks line done | same |
| private: tax, primer, kit, sticks, commit, feed, cal | Keychain `com.justinsato.pkm.database_url`, keystone `.env.local` (`PKM_SECRET_M365_LFI`) | see `CLAUDE.md` | same; loaded only from a source checkout |

Connector contract is documented at the top of `connectors/index.js`. Ingest errors are collected and never thrown.

### Jobs and schedules
In-process refresh on launch and every `refreshMinutes` (15). No server jobs, no launchd.

### Environments and secrets
- Local source run: `npm start` or `./start.sh`.
- Packaged builds: `npm run dist:mac`, `npm run dist:win`; `npm run release` uploads to R2 with `wrangler` (Cloudflare login on the machine, account id in `scripts/release.sh`).
- Secrets by name only: Todoist token (sealed in store), `DATABASE_URL` / `com.justinsato.pkm.database_url`, `PKM_SECRET_M365_LFI`.

### Security model
Renderers are context-isolated with narrow preload bridges. The viewer and Settings pages carry CSPs. `private/` is kept out of installers by the `build.files` allowlist in `package.json`. Card text is rendered with `textContent`, not HTML. There is no app-wide guard on renderer navigation or `window.open` (see adopt gaps).

### Commands
`npm test` (node:test, generic and private suites), `npm run test:generic`. No lint or typecheck configured.
