# Stickies design

## As built, 2026-10-03

### Navigation
There is no main window. The tray menu (🗒) is the navigation: note count, Refresh now, New note, Sources, Source look-ahead, Date filter, Pin all, Send all to background, Restack column, edge guard toggle, Reopen notes closed today, Start at login (packaged only), Settings, How Stickies works, Quit (`main.js` 390-465).

### Screens
| Screen | File | Journey |
|---|---|---|
| Card (collapsed 200px, expandable) | `note.html`, `note.js` | daily use |
| Step arrows when the column overflows | `arrow.html` | daily use |
| Settings | `settings.html`, `settings-page.js` | first launch, connecting sources |
| Markdown viewer | `viewer.js` | opening a card's source |
| How Stickies works | `OVERVIEW.md` in the viewer | help |
| Download page | `site/src/index.js` | install |

### Tokens in use
Card colours come from each connector's `color` (manual `#C9F2C7`, tax orange, primer yellow, kit blue, sticks purple, commit teal, feed salmon, cal gray). Geometry from `config.json`: width 200, min height 72, max height 300, gap 4, edge margin 8. Viewer uses a GitHub-like palette with a dark mode via `prefers-color-scheme`.

### Screen states
| Screen | Empty | Loading | Error | Success | No permission |
|---|---|---|---|---|---|
| Card column | no cards; tray shows "0 notes" | not shown (refresh is fast) | tray lists ingest errors with ⚠ | cards appear | edge guard warning in tray |
| Settings | first-launch prompt to connect a source | n/a | per-source test result | saved | Reminders asks macOS for Automation |
| Viewer | n/a | n/a | read failure logs and no-ops (inferred: no on-screen message) | rendered page | n/a |
| Download page | "no release published yet" (404 on `latest.json`) | n/a | 404 for unknown keys | installer list | Access policy |
