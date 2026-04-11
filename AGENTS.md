# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any shell command containing `curl` or `wget` will be intercepted and blocked by the context-mode plugin. Do NOT retry.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` to fetch and index web pages
- `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any shell command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with shell.
Instead use:
- `context-mode_ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### Direct web fetching — BLOCKED
Do NOT use any direct URL fetching tool. Use the sandbox equivalent.
Instead use:
- `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)
Shell is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `context-mode_ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `context-mode_ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### File reading (for analysis)
If you are reading a file to **edit** it → reading is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `context-mode_ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist |

---

# Branch layout & local build

This repo tracks upstream `Plutarch01/opencode-lcm` but ships a **local fork** that must survive upstream rewrites. Read this before touching branches.

## Branches

| Branch | Purpose | Rule |
|---|---|---|
| `master` | Mirrors local baseline built from upstream + cherry-picked fixes. `origin/master` is the local remote. | Only fast-forward merges from upstream. Never rebase. |
| `upstream/master` | Read-only pointer at `Plutarch01/opencode-lcm:master`. | Never push. Use `git fetch upstream` only. |
| `local/main` | **The branch that actually runs on this machine.** Carries local-only fixes that are not (yet) upstream. | Always ahead of `master`. Never force-pushed. Never deleted. |
| `origin/local/main` | Backup mirror of `local/main` on `Milofax/opencode-lcm`. | Push-only mirror. Never open a PR from it (see below). |
| `fix/*`, `feat/*` | Historical feature branches from earlier work. | Already folded into `master` or `local/main`. Treat as archive — do not re-merge blindly. |

`local/main` is the single integration branch. Every locally-built `dist/index.js` that OpenCode loads comes from it. The branch is mirrored to `origin/local/main` as an off-machine backup — nothing more.

### The GitHub PR-link trap

When you push `local/main`, GitHub prints a `Create a pull request for 'local/main'` URL. **Ignore it.** It is an auto-generated suggestion that appears on every new-branch push; it is not an invitation. Opening a PR from `local/main → master` (on either `origin` or `upstream`) would collapse the whole separation that this branch layout exists to protect:

- PR to `Milofax:master`: pollutes master with local-only commits (install scripts, `entities.json` gitignore, etc.) and the next `git fetch upstream && merge --ff-only` breaks with a non-FF error.
- PR to `Plutarch01:master`: ships host-specific artifacts to the upstream project. If you actually want to contribute a fix upstream, build a **clean feature branch from `master`** with just the relevant commits cherry-picked, and open the PR from there — not from `local/main`.

## Upgrading from upstream

1. `git fetch upstream`
2. `git checkout master && git merge --ff-only upstream/master` — hard fail if upstream rewrote history; investigate before `--force`.
3. `git checkout local/main && git rebase master` — resolve conflicts in favor of the local fix unless the upstream change obviously supersedes it.
4. `npm run typecheck && npm run lint && npm test` — all three must be green.
5. `npm run build && npm run install:local` — rebuilds `dist/` and refreshes the symlink in `~/.config/opencode/plugins/`.
6. Restart OpenCode.

Never merge `local/main` into `master`. Pushing `local/main` to `origin` is fine — it exists as a backup mirror — but never open a PR from it (see the PR-link trap above).

## Build & install

| Task | Command | Notes |
|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit` — must be clean before commit. |
| Lint | `npm run lint` | Biome. Two pre-existing `noExplicitAny` warnings in `src/index.ts` are expected; new errors are not. |
| Test | `npm test` | Builds `dist/` and `dist-tests/`, then runs node:test. Current baseline: **181 tests, 0 failures**. |
| Build | `npm run build` | `tsc -p tsconfig.json` → writes `dist/`. Required before install. |
| Install global | `npm run install:local` | Builds + symlinks `dist/index.js` → `~/.config/opencode/plugins/opencode-lcm.js`. |
| Install project | `npm run install:local:project` | Same, but targets `.opencode/plugins/` in CWD. |
| Install copy (no symlink) | `node scripts/install-local.mjs --copy` | Hard-copies instead of symlinking. Use only when the plugin dir is on a filesystem that blocks symlinks. |
| Skip rebuild | `node scripts/install-local.mjs --skip-build` | Reuses existing `dist/`. Use for fast iteration when the build is already fresh. |

The `file:///…/dist/index.js` entry in `~/.config/opencode/opencode.json` is what makes OpenCode load the local build **instead** of the npm package. That entry is the load-bearing part — if it is removed, OpenCode will silently auto-download the upstream npm version and the local fixes will vanish. Check it after any OpenCode config edit.

## Schema version guard

`src/build-freshness.ts` is wired into plugin init via `assertLocalBuildFreshnessSync()`. At load time it reads `src/constants.ts` and compares `STORE_SCHEMA_VERSION` against the value baked into `dist/constants.js`. If source is ahead of runtime, the plugin throws at startup with `Stale local opencode-lcm build detected: …`.

When you see that error: run `npm run build && npm run install:local` and restart. Do not bypass the guard — a mismatch means the SQLite store on disk may be about to get a migration that the running code cannot handle.

The guard is silent when running from the published npm package (no `src/constants.ts` next to `dist/`). It only activates for from-source installs, which is exactly this repo.

## Contributing upstream (rare)

If a fix on `local/main` genuinely belongs upstream:

1. `git checkout -b fix/<topic> master` — clean base, no local-install artifacts.
2. `git cherry-pick` the relevant commits from `local/main`. Skip anything that references `scripts/install-local.mjs`, `.gitignore` entries like `entities.json`, or anything scoped `(local)`.
3. `npm run typecheck && npm run lint && npm test` on the clean branch.
4. `git push origin fix/<topic>` and open the PR against `Plutarch01:master` from **that** branch, not from `local/main`.
5. When the PR merges upstream, drop the cherry-pick duplicate from `local/main` during the next rebase so the same change does not live in two places.

## Git hygiene

- `entities.json` is a Graphiti test artifact. It is gitignored — do not commit it.
- `.lcm/`, `.opencode/`, `dist/`, `dist-tests/` are gitignored. Never force-add them.
- Commit message style: `<type>(<scope>): <subject>` matching the existing log. Local-only commits should use scope `(local)` so they are easy to spot when rebasing onto upstream.
- Before committing, confirm no unresolved conflict markers are left in `src/store.ts` — that file has a history of surviving broken merges. `grep -n '<<<<<<< \|=======$\|>>>>>>> '` should return nothing.
