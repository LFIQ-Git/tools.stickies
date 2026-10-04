# Adopt baseline

- Date: 2026-10-03
- Commit: 3291345 (`main`)
- Checks: `npm test` 32 pass, 0 fail. No lint, typecheck or build gate configured. `npm audit --omit=dev`: 0 vulnerabilities.
- Prior work: score loop from 78 to 99 over three rounds (`app-score-loop.state.json`).

## Finish-phase items already met
- Tests for connectors, store and fuzzy matching (`test/`, `private/private.test.js`).
- Detailed `CLAUDE.md` and user-facing `OVERVIEW.md`.
- CSPs on the viewer and Settings pages; context isolation on every window.
- Release script with versioned R2 keys and a manifest (`scripts/release.sh`).

## Deferred
See "Deferred to owner" in `adopt-gaps.md`: code signing, publishing a release, branch protection.
