# DONE contract: tools.stickies adopt gaps

Approved 2026-10-03 under the fleet run rules. Each check must pass.

1. **Navigation guard.** `main.js` registers `app.on('web-contents-created')` that sets a `setWindowOpenHandler` returning `{ action: 'deny' }` and a `will-navigate` handler that prevents navigation off `file:`/`data:` pages, opening `https:` targets with `shell.openExternal`. Proof: `grep -n "web-contents-created" main.js` and a unit test of the URL decision function in `test/unit.test.js` passes.
2. **CI.** `.github/workflows/ci.yml` runs `npm ci` and `npm test` on `pull_request` and on push to `main`. Proof: the workflow file exists and the PR's CI run is green.
3. **Private exclusion test.** A test asserts every `build.files` entry is an explicit file or folder glob and none matches `private/`. Proof: `npm test` passes, and the test fails if `"private/**"` is added (checked once by hand).
4. **README.** `README.md` exists with what it is, run, test, release and docs links. Proof: file present.
5. **SessionStart hook.** `.claude/settings.json` has a SessionStart hook that runs `npm ci` only when `node_modules` is missing. Proof: file present and valid JSON.
6. **Suite still green.** `npm test` passes with at least 32 tests.
