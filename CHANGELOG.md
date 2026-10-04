# Changelog

## 1.0.1 (2026-10-03)

### Security
- Windows can no longer navigate themselves or open new windows. A link clicked inside a Markdown source in the viewer opens in the default browser if it is `https`, and is ignored otherwise.

### Added
- Continuous integration: the test suite runs on every pull request and every push to `main`.
- A test that fails if the installer file list ever includes the `private/` connectors.
- `README.md` and a Claude Code SessionStart hook that installs dependencies.

### Changed
- Score-loop records moved from the repo root to `docs/lfdev/score/`.

## 1.0.0 (2026-10-01)

- First public build: generic connectors (calendar feeds, Todoist, Apple Reminders, Markdown, todo.txt), Settings window, Mac and Windows installers, and the download page at stickies.lfiq.app.
