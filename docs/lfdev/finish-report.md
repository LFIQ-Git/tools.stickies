# Finish report: Stickies

Run 2026-10-03, unattended (fleet run 2026-10-02). Scaled to a 2,800-line tray app with no server of its own.

| # | Step | Status | Fixed | Left (with reason) | Needs a decision | Gates after |
|---|---|---|---|---|---|---|
| 0 | lfdev-audit | skipped | | The 2026-10-01 score loop (`docs/lfdev/score/`, 78 to 99) and the adopt review on 2026-10-03 serve as the audit; both are within 14 days and 3 commits | | 36/36 |
| 1 | lfdev-clean | done | Moved 4 score-loop files off the repo root | No dead code found worth removing in this pass | | 36/36 |
| 2 | lfdev-test | done | Added 4 guard tests (navigation policy, packaging allowlist, allowlist paths exist); 32 to 36 | | | 36/36 |
| 3 | lfdev-harden | done | Navigation and new-window guard on every renderer; `npm audit --omit=dev` 0 vulnerabilities | Installers unsigned by owner decision | Code signing (owner, declined 2026-10-01) | 36/36 |
| 4 | lfdev-perf | skipped | | No server, no measured slowness; refresh runs every 15 minutes in-process | | 36/36 |
| 5 | lfdev-polish | skipped | | The only open UI finding is keyboard focus between cards (score loop, 1 point); about a day of work, logged as an improvement | | 36/36 |
| 6 | lfdev-copy | done | README and changelog written to the plain-sentence standard | In-app text was already reviewed in the score loop | | 36/36 |
| 7 | lfdev-docs | done | `README.md`; `CLAUDE.md` file map lists `navguard.js` | | | 36/36 |
| 8 | lfdev-release | prepared, not deployed | Version 1.0.1, `CHANGELOG.md`, `docs/lfdev/release-1.0.1.md` | Publishing to R2 left to the owner | Run `npm run release` (owner) | 36/36 |

## Gates (clean install, 2026-10-03)
| Command | Exit | Result |
|---|---|---|
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` | 0 | |
| `npm test` | 0 | 36 tests, 36 pass |
| `npx electron-builder --mac --dir --arm64 --publish never` | 0 | app.asar lists 31 app files, 0 under `private/`, includes `navguard.js` |
| Packaged app launch with a temp profile | ran 7 s | no errors, store written |
| GitHub Actions CI on PR #1 | pass | 19 s |

Lint and typecheck are not configured in this repo (logged as an improvement in `adopt-gaps.md`).

## Final report
**Stickies, version 1.0.1, 2026-10-03.**
Stickies keeps today's to-dos on screen as small cards that float above every other window on a Mac or Windows computer. It pulls items from calendars, Todoist, Apple Reminders and plain-text lists, and marks them done at the source when a card is checked.

**State.** All 36 automated tests and the packaged Mac build pass as of this branch, and the same tests now run automatically on GitHub for every change. Prepared for release; not yet published.

**What this round improved.**
- Closed the one security finding: app windows can no longer be steered to outside web pages.
- Added automatic testing on every change, which the repo did not have.
- Added a test that stops Justin's private connectors from ever shipping in an installer, replacing a manual check.
- Raised the test count from 32 to 36.
- Added a README and a changelog.

**Risks and open decisions.**
- Installers stay unsigned, so new users see an operating-system warning on install (Justin, decided 2026-10-01).
- Version 1.0.1 is built and documented but not uploaded to the download site (Justin, `npm run release`).

**How it is run.** Release and rollback steps: `docs/lfdev/release-1.0.1.md`. Rollback: point `latest.json` back at the 1.0.0 installers kept in R2. Monitoring: Worker observability in Cloudflare; ingest errors show in the tray menu.

Next: /lfdev-ship
