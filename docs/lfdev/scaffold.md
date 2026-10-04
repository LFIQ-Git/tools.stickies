# Stickies scaffold check

As of 2026-10-03, commit 3291345.

| Item | State | Evidence |
|---|---|---|
| CI gate on pull requests | Missing | no `.github/workflows/` |
| Tests | Present | `npm test`, 32 passing |
| Lint / typecheck | Missing | no eslint or tsc config; `types.js` holds JSDoc typedefs only |
| Environment manifest and check | Not applicable | no env vars at runtime; secrets live in Keychain or sealed store |
| Migrations tooling | Not applicable | single JSON store, no database of its own |
| Agent guardrails (`CLAUDE.md`) | Present | detailed `CLAUDE.md` |
| SessionStart hook | Missing | no `.claude/settings.json` |
| README | Missing | only `CLAUDE.md` and `OVERVIEW.md` |
| CHANGELOG | Missing | none |
| Branch protection | Unknown, out of scope | repo settings are hands-off in this run |
| Packaging guard for `private/` | Manual | `CLAUDE.md` asks for an asar listing before release; no automated check |
