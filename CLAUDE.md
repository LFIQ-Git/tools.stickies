# stickies — always-on-top to-do notes (Mac + Windows)

Electron tray app that floats sticky notes over every app, one card per
to-do, pulled from connectors. Distributed as installers at
**https://stickies.lfiq.app** (Worker `stickies-downloads`, installers in R2
bucket `stickies-releases`, both on the Left Field Investments account; the
hostname sits behind the `*.lfiq.app` Access policy). Listed on the launcher
under Applications → Utilities (apps.lfiq.app/applications?group=utilities).

## Run and ship

```bash
npm start              # from source; also loads private/ connectors
npm test               # generic + private suites (node:test)
npm run dist:mac       # dist/Stickies-<v>-mac-{arm64,x64}.dmg (ad-hoc signed)
npm run dist:win       # dist/Stickies-<v>-windows-x64-setup.exe (NSIS, cross-built, no Wine needed)
npm run release        # tests, builds both, uploads to R2, writes latest.json
cd site && npx wrangler deploy   # only when site/src changes
```

Bump `version` in package.json before `npm run release`; keys are versioned
(`v<version>/...`) and the page reads `latest.json`, so a release needs no
Worker deploy. Installers are unsigned (no Apple Developer ID / Windows code
signing cert): Mac users go through Privacy & Security → Open Anyway, Windows
users through SmartScreen → Run anyway. The download page says so.

Locally Justin runs it from source via `./start.sh` (tray-only, 🗒 in the menu
bar). Not a launchd job and must never become one (launchd fleet is retired).
Packaged builds offer tray → Start at login.

## Connectors

Built-in (ship in the installers): `ics` calendar feeds, `todoist` (API v1,
personal token), `reminders` (macOS, JXA), `markdown` checklists, `todotxt`,
plus `manual` notes. User-facing behavior is in `OVERVIEW.md` (bundled, opened
from the tray). New users get Settings on first launch.

`private/` holds Justin's connectors (tax, M365 cal, sticks, commit, feed,
primer, kit) and their `config.json`. It is excluded from the build by the
explicit `build.files` allowlist in package.json — keep it an allowlist. It
loads only from a source checkout (`!app.isPackaged`) or if set as the custom
connectors folder in Settings; a folder with `index.js` loads only that file.
`pg` is a devDependency for the same reason. Before a release, confirm with
`npx @electron/asar list dist/mac-arm64/Stickies.app/Contents/Resources/app.asar`
that nothing from `private/` is inside.

### Private connector details

| Source | Color | Where | What becomes a note |
|--------|-------|-------|---------------------|
| tax | orange | `deadlines.json` — Dropbox canonical (`~/Library/CloudStorage/Dropbox-LFI/Leftfieldinv Team Folder/LFI/LFI Corp/Tax/Left Field Investments LLC/_Action-Items/`), SSD mirror fallback (`ACTIVE/accounting/Taxes/_Action-Items/`) | open items due ≤14 days (incl. past due), plus undated `kind:"overdue"` items. Undated ASAP backlog is excluded on purpose. |
| primer | yellow | `ACTIVE/PKM/primers/primer-YYYY-MM-DD.md` | "The One Thing" + each "Need to Do Today" item |
| kit | blue | `ACTIVE/PKM/daily/YYYY-MM-DD.md` | each TODAY'S BOARD bullet + each DEADLINES THIS WEEK bullet (routine display name is "Company Morning Brief" as of 2026-08-24, task id stays `kit-morning-brief`; parser keys off the `##` section headers, not the name) |
| sticks | purple | Neon `items.tasks` (the live Sticks/Kit task store; `DATABASE_URL` from Keychain `com.justinsato.pkm.database_url` else keystone `.env.local`) | open tasks due within [-7, +3] days, or priority ≥90 without a stale due date; hide rules from `items.user_settings` applied; capped at 8; fuzzy-deduped against the other sources' notes. Its ✓ closes the task in `items.tasks` for real (`status='done'`, `completed_by: stickies`). |
| commit | teal | Neon `items.commitments` (the LIVE commitment store; the pkm_get_commitments MCP tool reads a dead table) | unfulfilled commitments due within [-14, +7] days, cap 8. Us/them twin rows collapse to one card, and ✓ fulfills BOTH twins (`fulfilled_at`, `status: done`) so the known one-sided-close trap can't fake aging loops. |
| feed | salmon "Alert" | Neon `public.agent_feed` | items with status pending/UNREAD from the last 3 days. The feed is machine-written and repeats itself, so rows group into one card per alert family (`feedGroupKey`: cron-failure-per-job, reconcile digest, commitment sweep, else the title with dates/counts/emoji stripped); `item_type` listed in `excludeTypes` is dropped (default CRON_ERROR/CRON_WARNING); cap 6; then fuzzy-deduped against the other sources. A card standing for several rows shows `(N×)`, and its ✓ sets DISMISSED on **every** row behind it — dismissing only the titling row was why alerts kept coming back. Note id is `feed:<group-hash>:<date>`, so a genuinely new batch tomorrow returns. |
| cal | gray | Microsoft Graph calendarView, app-only creds from `PKM_SECRET_M365_LFI` in keystone `.env.local` | today's remaining meetings (ended ones drop off on refresh, and stale cards auto-remove). Read-only: ✓ just dismisses. |
| manual | green | tray → New note | user-created |

Tray → **Sources** submenu toggles each source; toggling off removes its cards
(manual and user-edited cards stay) and re-enabling re-ingests on refresh.

Refresh on launch and every 15 min (`config.json`).

### Private write-backs

✕ never touches sources. ✓ does:
- tax → sets `"done": true` (+ audit prefix on `note`) in the CANONICAL
  Dropbox deadlines.json only (`dataFile`); refuses with a dialog if only the
  read-only SSD mirror is reachable.
- primer/kit → strikes the line in today's file (best-effort, cosmetic) and
  adds the text to `completed` in the store. Because primer/kit ids are
  date-scoped, suppression is by content: word-set Jaccard ≥0.6 against
  completed entries (90-day retention) keeps the same open task from
  re-surfacing daily. Truly closing a PKM-backed task still happens in Sticks;
  suppression only keeps it off the sticky board.

## Layout

One tight column flush to the right edge of the primary display (4px gap,
packed by actual card height, order tax → primer → kit → manual). The column
repacks automatically on expand/collapse/close. A user-dragged note gets
`userMoved` and is left alone; tray → "Restack column" clears the flags,
resets scroll, and re-tightens everything. When the stack is taller than the
screen the column scrolls vertically: mouse wheel over any card shifts the
whole column, and cards clipped past the edge hide until scrolled back.

## Card anatomy

Collapsed card (200px, half the v1 size) shows a summary clause; "▼ more"
expands to the full statement. Buttons: ✓ mark done AT SOURCE and close,
📌 send-to-background toggle, ✕ hide only. Source chip opens the file in the
built-in formatted markdown viewer (`marked`, GitHub-ish styling, dark-aware),
never an IDE; non-md sources fall back to the OS default app.

## Behavior contract

- Note ids are stable (`tax:<item-id>`, `primer:<date>:<hash>`, `kit:<date>:<section>:<hash>`).
  Closing a note records its id in `dismissed`; re-ingest skips dismissed ids.
  Tax dismissals therefore stick until the item changes; primer/kit ids are
  date-scoped so each day starts fresh.
- Editing a note sets `userEdited` and ingest stops overwriting its text.
  Changing a deadline sets `userDeadline`, same deal.
- Pinned notes sit at `screen-saver` level on all Spaces; "send to background"
  drops to normal level (card dims slightly). Tray has pin-all / background-all.
- Untouched primer/kit notes auto-expire after 3 days; dismissals prune at 45.
- All state in `<userData>/stickies-store.json` (`~/Library/Application
  Support/stickies` on this Mac; `%APPDATA%\Stickies` on Windows). Connector
  settings live under `settings.connectors.<key>`; secrets are sealed with
  safeStorage. `STICKIES_USER_DATA=<dir>` runs a separate profile for testing
  next to a live copy.

## Files

`main.js` windows/tray/refresh/IPC · `connectors/` built-in sources + registry
(contract documented at the top of `connectors/index.js`) · `settings.js` +
`settings.html` + `settings-page.js` Settings window · `secrets.js` safeStorage
encryption · `layout.js` column engine + step arrows · `guard.js` macOS edge
guard · `viewer.js` markdown viewer · `store.js` persistence · `types.js` Note
typedefs · `note.html/js` card renderer · `arrow.html` step arrows ·
`preload*.js` IPC bridges · `config.json` geometry + refresh default ·
`private/` Justin's connectors (never packaged) · `site/` download Worker ·
`scripts/release.sh` publish · `scripts/make-icons.py` icons · `test/` +
`private/*.test.js` (node:test).

## Gotchas

- Generic code uses the machine's local date (`connectors/util.js` todayLocal);
  the private connectors stay on Pacific. Never `toISOString().slice(0,10)`
  (UTC; already caused one bug).
- The parsers are format-coupled: primer sections are `**N. Header**` bold
  lines; kit sections are `## HEADER` inside the daily note. If those routine
  templates change, update `ingest.js`.
- The tax-deadline-countdown SKILL.md's Dropbox path is stale; the real
  _Action-Items path is the one in `config.json` (verified 2026-08-24).
