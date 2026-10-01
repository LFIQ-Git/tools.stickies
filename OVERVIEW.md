# How Stickies works

Stickies puts today's to-dos on your screen as sticky notes. Notes float above
every app in one tight column on the right edge of the main display, refresh
from the sources you connect, and write back to those sources when you close
an item as done.

## Getting started

1. Open **Settings…** from the Stickies icon in the menu bar (Mac) or the
   system tray (Windows).
2. Turn on the sources you use and fill in their details. **Test** shows what
   a source would put on the board right now.
3. Click **Save**. Notes appear within a few seconds and refresh every
   15 minutes (change this under General).

**New note** in the tray menu adds a blank note of your own at any time.

## Sources

| Source | Chip | What makes a note | What ✓ does |
|--------|------|-------------------|-------------|
| Calendar (iCal link) | Cal | Today's meetings that have not ended, from any calendar's private iCal (.ics) address. Several calendars can be listed, one per line. | Closes the card. Calendars are read-only. |
| Todoist | Todoist | Tasks matching your filter (default `today \| overdue`), highest priority first. | Completes the task in Todoist. Recurring tasks move to their next date. |
| Apple Reminders (Mac) | Remind | Open reminders due within the look-ahead window, from all lists or the ones you name. | Completes the reminder. |
| Markdown checklists | List | Every open `- [ ]` task in the files you pick, due within the look-ahead window (undated tasks optional). | Ticks the box in the file: `- [x]`. |
| todo.txt | todo | Open lines in a todo.txt file, priority first. | Marks the line complete the todo.txt way: `x <date> …`. |
| Your notes | Note | Notes you write yourself (tray → New note). | Closes the card. |

When a task is finished somewhere else (in Todoist, in the file, in
Reminders), its note leaves the board on the next refresh.

### Where to find the details

- **Calendar addresses.** Google Calendar: Settings → your calendar →
  *Secret address in iCal format*. Outlook: Settings → Calendar → Shared
  calendars → Publish a calendar → ICS link. iCloud: share the calendar as a
  Public Calendar and copy the link. Treat these addresses like passwords;
  Stickies stores them encrypted.
- **Todoist token.** Todoist → Settings → Integrations → Developer → API token.
  Stored encrypted with your system's credential store.
- **Markdown due dates.** Any of `📅 2026-10-03` (Obsidian Tasks),
  `due:2026-10-03`, `[due:: 2026-10-03]` (Dataview) or `@due(2026-10-03)`.
- **todo.txt due dates.** `due:2026-10-03`.
- **Apple Reminders.** The first refresh asks for permission to control
  Reminders. If you declined, turn it on in System Settings → Privacy &
  Security → Automation → Stickies.

## The board

- **One column, far right.** Notes pack top to bottom by height. When the
  stack outgrows the screen, scroll the mouse wheel over any note to slide the
  whole column; notes past the edge hide until scrolled back.
- **Step arrows.** When the stack overflows, ▲/▼ pills appear above and below
  the column. Each click moves exactly one note.
- **Drag** any note anywhere; it keeps its spot until you use Restack column.
- **Always on top** by default (on Mac, on every desktop Space).

## Note anatomy

| Element | What it does |
|---------|--------------|
| Color + source chip | Which source the note came from. Click the chip to open the source: the file for Markdown and todo.txt, the task in Todoist. |
| Deadline chip | OVERDUE Nd (red), Today (red), Tomorrow (amber), date + countdown, or "+ date". Click it to set or change the date. |
| Note face | A one-line summary. **▼ more** shows the full text, **▲ less** collapses it. |
| Double-click the text | Edit in place. Edited notes are yours: refresh never overwrites them. |
| ✓ | Mark done at the source (see the table above) and close the note. |
| 📌 | Send this note to the background (normal window level, slightly dimmed). Click again to pin it back on top. |
| ✕ | Hide the note only. Nothing changes at the source. |

## Keyboard

On the active note (click it first; keys are ignored while editing):
**space/enter** expand or collapse · **e** edit · **d** done ·
**x** or **backspace** hide · **p** pin toggle · **↑/↓** step the column one
note. The buttons are also reachable with Tab.

## Tray menu

- **Refresh now** — re-read every enabled source.
- **New note** — a blank note in edit mode.
- **Sources** — turn a source on or off. Turning one off removes its notes;
  your own notes and edited notes stay.
- **Source look-ahead** — how far ahead each dated source fetches (Markdown,
  todo.txt, Reminders). Narrowing it removes notes beyond the new window.
- **Date filter** — display-only cap on how far ahead the board shows. Past
  due, today and undated notes always show.
- **Pin all on top / Send all to background** — the whole board at once.
- **Restack column** — pull dragged notes back into the column.
- **Snap windows at column** (Mac) — while pinned notes are visible, a window
  you maximize stops at the column instead of sliding under it. Needs
  Accessibility permission for Stickies.
- **Reopen notes closed today** — bring back today's closed notes (does not
  undo anything at a source).
- **Start at login** — launch Stickies when you sign in.
- **Settings…** and **Quit Stickies**.

## Custom connectors

Settings → General → *Custom connectors folder* loads extra sources from a
folder of JavaScript files. If the folder has an `index.js`, only that file
loads. Each module exports one connector, an array, or `{ connectors: [...] }`:

```js
module.exports = {
  key: 'mytasks',              // unique id
  label: 'My task system',     // shown in Settings and the tray
  chip: 'Mine', color: '#E4CCF7',
  defaultEnabled: true,
  fields: [{ name: 'url', label: 'Server URL', type: 'text' }],
  async ingest(cfg) {
    // return { notes: [{ id: 'mytasks:42', text, deadline: 'YYYY-MM-DD' | null }], error? }
    // ids must be stable and start with your key.
  },
  async done(note, cfg) { /* mark it complete; throw to refuse */ },
};
```

Custom connectors run with the same access as Stickies itself. Only load code
you wrote or trust.

## Your data

Notes, positions and settings live in the Stickies folder of your user
profile (`~/Library/Application Support/Stickies` on Mac,
`%APPDATA%\Stickies` on Windows). Tokens and calendar addresses are encrypted
with the macOS Keychain or Windows DPAPI. Stickies talks only to the sources
you turn on; there is no Stickies server and no telemetry.
