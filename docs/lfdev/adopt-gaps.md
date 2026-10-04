# Stickies adopt gaps

Found 2026-10-03 at commit 3291345. Decisions were made under the 2026-10-02 fleet run rules (owner asleep): Risk, Broken promise and in-repo guardrails approved; anything needing a business decision, money, credentials or infrastructure deferred.

## Risk
1. **No navigation or new-window guard on any renderer.** `viewer.js` loads source Markdown with `marked`; a link in that file navigates the viewer window itself to any site, and no window sets `setWindowOpenHandler` or a `will-navigate` handler (`grep` finds none). Fix: one `web-contents-created` handler in `main.js` that denies `window.open`, blocks navigation away from the app's own pages, and sends `https:` links to the default browser. **Approved.**

## Broken promise
None found. The score loop (`docs/lfdev/score/app-score-loop.state.json`) reached 99/100 and its remaining deduction is an improvement, listed below.

## Missing guardrail
2. **No CI.** No `.github/workflows/`. Fix: a workflow that runs `npm ci` and `npm test` on pull requests and pushes to `main`, with the Electron binary download skipped. **Approved.**
3. **`private/` exclusion is checked by hand.** `CLAUDE.md` asks for an asar listing before each release. Fix: a unit test that fails if `build.files` stops being an explicit allowlist or ever matches `private/`. **Approved.**
4. **No README.** Fix: a short `README.md` with what it is, run, test, release and where the docs live. **Approved.**
5. **No SessionStart hook.** Fix: `.claude/settings.json` that installs dependencies when `node_modules` is missing. **Approved.**
6. **No CHANGELOG.** Fix: add one during the release step of `/lfdev-finish`. **Approved (finish).**

## Improvement
7. Keyboard users cannot move focus between cards (`note.js`; last score-loop deduction). Later.
8. No lint or typecheck. Later; the code is plain CommonJS with JSDoc types.
9. Score-loop artifacts (`docs/lfdev/score/app-score-loop.state.json`, `scorecard-*.json`) sit at the repo root. Move them under `docs/lfdev/score/` during clean. **Approved (finish).**
10. The viewer gives no on-screen message when a source file cannot be read (`viewer.js` logs only). Later.

## Deferred to owner
- Code signing and notarization (Apple Developer ID, Windows certificate): declined by the owner 2026-10-01, needs money.
- Publishing a new release to R2 (`npm run release`) and any `site/` Worker deploy: production infrastructure and Cloudflare credentials.
- Branch protection or rulesets on `LFIQ-Git/tools.stickies`: repo settings are out of scope for this run.
