# Stickies — App Overview

Post-it notes for the things your routines say you need to know today or
tomorrow. Notes float above every app in a single tight column on the right
edge of the screen, refresh from live sources every 15 minutes, and write
back to those sources when you close an item as done.

## The board

- **One column, far right.** Cards pack top to bottom by height. When the
  stack outgrows the screen, scroll the mouse wheel over any card to slide
  the whole column; cards past the edge hide until scrolled back.
- **Step arrows.** When the stack overflows, translucent ▲/▼ pills appear
  centered above and below the column. Each click moves exactly one card
  boundary. ▲ shows only when there is something above, ▼ only when there is
  something below; both disappear when everything fits.
- **Drag** any card anywhere; it keeps its spot until you use Restack column.
- **Always on top** by default, on every desktop Space.

## Card anatomy

| Element | What it does |
|---------|--------------|
| Color + source chip | Which feed the card came from (see Sources). Clicking the chip opens the source file in a formatted markdown viewer, where one exists. |
| Deadline chip | OVERDUE Nd (red), Today (red), Tomorrow (amber), date + countdown, PAST DUE / ASAP (purple), or "+ date". Click it to set or change the date. |
| Card face | A one-line summary. **▼ more** drops down the full statement, **▲ less** collapses it. |
| Double-click the text | Edit in place. Edited cards are yours: refresh never overwrites them. |
| ✓ | **Mark done at the source** and close the card (see per-source behavior below). |
| 📌 | Send this card to the background (normal window level, slightly dimmed). Click again to pin it back on top. |
| ✕ | Hide the card only. Touches nothing at the source. Tax/Sticks hides stick; primer/brief cards start fresh each day. |

## Keyboard

On the active card (click it first; keys are ignored while editing):
**space/enter** expand or collapse · **e** edit · **d** mark done at source ·
**x** or **backspace** hide · **p** pin toggle · **↑/↓** step the column one
card. The buttons are also tabbable, with a visible focus ring.

## Sources

| Chip | Color | Reads from | What makes a card | What ✓ does |
|------|-------|-----------|-------------------|-------------|
| TAX | orange | `deadlines.json` in the canonical Dropbox tax tree (SSD mirror as read fallback) | open items due within 14 days, past due, or flagged overdue; the undated ASAP backlog is excluded | sets `"done": true` in the canonical Dropbox file with an audit stamp. Refuses if only the read-only SSD mirror is reachable. |
| CAL | gray | Microsoft Graph calendar (same app-only LFI credentials Keystone uses) | today's remaining meetings, with time, location, organizer; ended meetings drop off | dismisses only (nothing to correct on a calendar) |
| STICKS | purple | Neon `items.tasks`, the live store behind Sticks and the brief's priority stack | open tasks due within the last 7 / next 3 days, or priority ≥ 90 without a long-dead due date; your Sticks hide rules apply; capped at 8; deduped against the other sources | closes the task for real (`status: done`), so it leaves Sticks too |
| COMMIT | teal | Neon `items.commitments`, the live commitment store | unfulfilled commitments due within the last 14 / next 7 days, capped at 8; us/them twin rows collapse into one card | fulfills the commitment AND its twin row, so a one-sided close can't fake an aging open loop |
| ALERT | salmon | Neon `agent_feed` | pending/unread escalations from the last 3 days. A repeating alert (a failing cron, the daily reconcile digest that re-titles itself each run) shows as ONE card marked `(N×)`, not N cards. Cron failure/warning rows are excluded by default — flip `feed.excludeTypes` in `config.json` to see them. Capped at 6, then deduped against the other sources | marks every row behind the card DISMISSED, so it does not come back |
| PRIMER | yellow | Your Daily Primer (6:14 AM, `PKM/primers/`) | The One Thing + each Need to Do Today item | strikes the line in today's file and suppresses matching items from future days |
| KIT | blue | Company Morning Brief (7:03 AM, `PKM/daily/`) | each Today's Board bullet + each Deadlines This Week bullet | same as Primer: strikethrough + suppression |
| NOTE | green | you (tray → New note) | manual | just closes |

Duplicates across feeds (the same IRS payment in Tax, Sticks, and the brief)
are fuzzy-matched and shown once. Suppression from ✓ is also fuzzy, so
"3 days overdue" still matches tomorrow's "4 days overdue".

## Tray menu options

- **Refresh from routines** — re-ingest all enabled sources now (otherwise every 15 min).
- **Sources** — toggle any feed on or off. Toggling off removes its cards; manual and edited cards stay.
- **New note** — a blank green post-it in edit mode.
- **Date filter** — cap how far ahead the board looks, measured in days ahead: Today + past due only, 1/3/7/14/30 days, or No limit. Past due and today always show; undated cards (alerts, ASAP items, work-order clusters) always show because there is no date to filter on. Display-only: nothing is dismissed, widening the filter brings cards back.
- **Source look-ahead** — how far ahead each feed even FETCHES, shown with its current value inline (Tax deadlines, Sticks tasks, Commitments, plus Alerts max age looking backward). These are the ceilings the Date filter works under: "No limit" shows everything ingested, so pair a 30-day date filter with a 30-day tax window. Changes persist, override the config.json defaults (marked "(default)" in each list), and re-ingest immediately. Narrowing a window retro-removes cards beyond it on the next refresh; cards you've edited stay. Alert cards, having no deadline, stay on the board once ingested until closed with ✓/✕ even if the age window later narrows.
- **Pin all on top / Send all to background** — the whole board at once.
- **Restack column** — pull dragged cards back into the tight column and scroll to top.
- **Snap stops at column (edge guard)** — while pinned notes are visible, a window you snap or maximize gets its right edge clamped to the column's inside edge instead of sliding under the notes. Uncheck to let windows go under. Needs Accessibility access for Electron; the menu warns if that's missing.
- **Reopen notes closed today** — undo today's ✕/✓ closures on the board (does not un-close anything at a source).
- **App overview** — this page.

## Plumbing

Runs as a tray-only app (🗒, no Dock icon), started at login by
`~/Applications/Stickies.app` (waits for the SSD to mount, then launches).
State lives in `~/Library/Application Support/stickies/`; sources are
read with credentials already on this Mac. Tuning knobs (caps, day windows,
priority threshold, refresh cadence) are in `stickies/config.json`.
