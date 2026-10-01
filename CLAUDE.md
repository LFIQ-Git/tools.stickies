# stickies — Routine Post-It Notes

Electron tray app that floats post-it notes over every macOS app. Notes are
generated from Justin's daily routines and are draggable, editable, closable,
and can be sent behind other windows per note or all at once.

## Run

```bash
cd "/Volumes/minibase/justinsato/Projects/ACTIVE/2 Apps/tools.stickies"
npm start          # or ./start.sh
```

Tray-only (no Dock icon): look for the 🗒 in the menu bar. Quit from the tray
menu. Not a launchd job and must never become one (launchd fleet is retired);
if auto-start at login is ever wanted, use a macOS Login Item pointing at
`start.sh`.

## Sources (read-only)

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

## Writes

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
- All state in `~/Library/Application Support/stickies/stickies-store.json` —
  app works with the SSD unmounted (sources just report unreachable in the
  tray menu).

## Files

`main.js` windows/tray/refresh/IPC · `layout.js` column engine + step arrows ·
`guard.js` edge guard (adaptive backoff) · `viewer.js` markdown viewer ·
`ingest.js` file-source parsers · `sticks.js` Neon sources (tasks/commitments/feed) ·
`calendar.js` Graph calendar · `store.js` persistence · `types.js` Note typedefs ·
`note.html/js` card renderer (keyboard: space/enter expand, e edit, d done,
x hide, p pin, ↑/↓ step) · `arrow.html` step arrows · `preload.js` IPC bridge ·
`config.json` paths + thresholds · `test/` unit tests (`npm test`, node:test).

## Gotchas

- Dates are all Pacific via `toLocaleDateString('en-CA', {timeZone:'America/Los_Angeles'})`
  — never `toISOString().slice(0,10)` (UTC; already caused one bug).
- The parsers are format-coupled: primer sections are `**N. Header**` bold
  lines; kit sections are `## HEADER` inside the daily note. If those routine
  templates change, update `ingest.js`.
- The tax-deadline-countdown SKILL.md's Dropbox path is stale; the real
  _Action-Items path is the one in `config.json` (verified 2026-08-24).
