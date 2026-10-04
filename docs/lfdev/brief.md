# Stickies brief

## As built, 2026-10-03

**What it is.** Stickies is an Electron tray app for Mac and Windows that floats one small always-on-top card per to-do along the right edge of the main display. Cards are pulled from connected sources and stay until the user marks them done or hides them (`main.js`, `connectors/`).

**Core purpose.** Keep today's open to-dos visible over every other window, so nothing due today is missed.

**Users.**
- Justin, running from a source checkout with private connectors for tax deadlines, PKM primer and morning brief, Sticks tasks, commitments, the agent feed and the M365 calendar (`private/`, `CLAUDE.md`).
- Anyone who installs the unsigned Mac or Windows build from https://stickies.lfiq.app and connects calendar feeds, Todoist, Apple Reminders, Markdown checklists or todo.txt (`connectors/`, `site/`). Inferred: the audience is Justin's own team and contacts, since the site sits behind the `*.lfiq.app` Access policy.

**Jobs.**
1. See what is due today without opening another app.
2. Mark an item done once, on the card, and have the source record it (`done()` in each connector, `note:done` in `main.js`).
3. Hide an item without touching the source.
4. Jot a manual note.
5. Connect sources without editing files (Settings window, `settings.js`).

**Critical journeys.**
1. First launch: Settings opens, the user connects a source, cards appear in the column.
2. Daily use: refresh on launch and every 15 minutes (`config.json`), check a card done, the card closes and the source updates.
3. Install: download page lists the current installers from `latest.json`, user installs and passes the unsigned-app warning.

**Out of scope as built.** Sync between machines, mobile, sharing notes with others, code signing (declined 2026-10-01, `CLAUDE.md`).
