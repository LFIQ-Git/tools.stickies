# Build: tools.stickies adopt gaps
Started: 2026-10-03  |  Status: COMPLETE

## Objective
Close the approved gaps from `docs/lfdev/adopt-gaps.md`: a renderer navigation guard, CI, an automated check that `private/` never ships, a README and a SessionStart hook.

## DONE means
- [x] Navigation guard: `navguard.js` + `installNavGuard(app, shell)` in `main.js`; `npm test` covers `navTarget` → pass
- [x] CI: `.github/workflows/ci.yml` runs `npm ci` + `npm test` on PRs and `main` → green on the PR
- [x] Private exclusion test in `test/guards.test.js` → pass; fails when `private/**` is added (checked by hand: 1 fail)
- [x] README.md present
- [x] `.claude/settings.json` SessionStart hook, valid JSON
- [x] `npm test` → 36 pass, 0 fail

## Explicitly NOT in scope
- Code signing, publishing a release, branch protection: deferred to owner (`adopt-gaps.md`).
- Keyboard focus between cards, lint/typecheck: improvements for later.

## Decision log
| # | Decision | Reasoning | Reversible? |
|---|----------|-----------|-------------|
| 1 | Block all renderer-initiated navigation; send only `https:` to the browser | No window needs to navigate itself; `http:` and `file:` links in source files are not worth the exposure | Yes |
| 2 | CI skips the Electron binary download | Tests are pure node:test; saves ~100 MB per run | Yes |

## Blockers
_(none)_

## Session log
### 2026-10-03
- Guard tests written first (failed on missing module), then `navguard.js`. Suite 36/36.
- Smoke launch from source with a temp profile ran 8 s with no errors and wrote a store.
