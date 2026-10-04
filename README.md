# Stickies

Always-on-top sticky notes for today's to-dos on Mac and Windows. A tray app
floats one small card per item along the right edge of the screen, pulled from
calendar feeds, Todoist, Apple Reminders, Markdown checklists and todo.txt.
Checking a card marks the item done at its source.

Installers: https://stickies.lfiq.app (unsigned by decision; see `CLAUDE.md`).

## Run

```bash
npm install
npm start          # or ./start.sh on Justin's Mac (tray only)
```

`STICKIES_USER_DATA=<dir> npm start` runs a separate profile next to a live copy.

## Test

```bash
npm test           # generic and private suites (node:test)
npm run test:generic
```

CI runs `npm test` on every pull request and push to `main`.

## Release

Bump `version` in `package.json`, update `CHANGELOG.md`, then `npm run release`
(builds both installers, uploads to R2, writes `latest.json`). The download
Worker in `site/` needs a deploy only when `site/src` changes.

## Docs

- `CLAUDE.md`: architecture, connectors, behavior contract and gotchas.
- `OVERVIEW.md`: the user guide bundled with the app.
- `docs/lfdev/`: brief, spec, design, gap list and release notes.
