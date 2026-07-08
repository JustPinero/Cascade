# Fix 41.D9 — Portable webhook-hook path (unblock fleet rollout)

## Objective
Make the 41.5 canonical Stop-hook script referenceable by a
`$HOME`-relative path so the fleet rollout can write it into TRACKED,
cross-machine-synced `.claude/settings.json` without breaking the hook
on a machine whose Cascade checkout lives at a different absolute path.

## Problem (from debt [41.D9])
`scripts/install-hooks.ts` bakes an absolute path
(`/Users/justinpinero/Desktop/projects/Cascade/scripts/session-complete-hook.sh`)
into each project's settings.json. That file is tracked and synced
across machines; the Mac path is invalid on the Windows machine, so the
hook silently dies there after a pull — a regression vs the current
portable inline `curl`.

## Design (option a from the debt entry)
The canonical script gets installed to a machine-stable, `$HOME`-relative
location; the hook references THAT path, which resolves correctly on any
machine.

- Install target: `~/.cascade/session-complete-hook.sh`.
- `buildWebhookCommand` references `"$HOME/.cascade/session-complete-hook.sh"`
  (shell expands `$HOME` per machine).
- `install-hooks.ts` copies `scripts/session-complete-hook.sh` →
  `~/.cascade/session-complete-hook.sh` (idempotent; overwrites so script
  updates propagate) BEFORE writing project settings, and also on Cascade
  server startup (instrumentation) so a freshly-cloned machine self-heals
  even before install-hooks is re-run.
- The spool path default (`~/.cascade/webhook-spool.jsonl`) already lives
  under `~/.cascade` — the script home is consistent with it.

## Acceptance Criteria → Test Mapping

| Criterion | Test |
|-----------|------|
| buildWebhookCommand emits a `$HOME`-relative script path | unit: composed command contains `"$HOME/.cascade/session-complete-hook.sh"`, no absolute `/Users/...` path |
| Hook command still backgrounds + passes `$PWD` + port | unit: shape `bash "$HOME/.cascade/session-complete-hook.sh" "$PWD" <port> … &` |
| Script-install copies canonical script to ~/.cascade (injectable home) | unit: given a scratch HOME + source script, after install the target exists and matches source |
| Script-install is idempotent and refreshes on change | unit: run twice / with changed source → target equals latest source, no error |
| install-hooks places the script before writing settings | unit/integration: processing a scratch project also results in the script present at the scratch-home target |
| Existing tracked settings.json with the old absolute/inline hook is updated in place (no duplicate Stop hook) | unit: fixture settings with the prior Cascade Stop hook → single updated entry, `$HOME` path |

## RED Phase
All six rows as failing tests first (buildWebhookCommand path assertion
flips; new script-install-copy fn doesn't exist yet).

## GREEN Phase
Goal condition: all fix-41.D9 RED tests pass AND scripts/validate.sh
exits 0.

## Files to Touch (verify at Prime)
- scripts/install-hooks.ts (buildWebhookCommand + a copyCanonicalScript
  step, home injectable for tests)
- instrumentation.ts (place the script on startup, next to the spool
  drain wiring)
- scripts/install-hooks.test.ts (+ the buildWebhookCommand assertions)
- references/api-contracts.md / architecture.md if the hook contract note
  needs it

## Constraints
- Do NOT run the fleet rollout in this request — this only makes it SAFE.
  Rollout stays a separate, deliberate step after this lands.
- Home/target paths injectable so tests never touch the real ~/.cascade.
- Idempotent, and never throws into Cascade startup.

## Dependencies
Closes the blocker on [41.D9]. After this: the fleet rollout
(`install-hooks.ts` across all 22 projects) is safe to run and commit.
