# Cascade Windows Dispatch — wt.exe + Git Bash

## Context

Cascade was built on macOS and runs Claude Code via `osascript` → Terminal.app on Mac, `tmux` on Linux/WSL2. After Justin's Mac → Windows migration on 2026-04-15, the dispatcher silently broke: `launchInTerminal`'s non-`darwin` branch spawned a detached `bash` with `stdio: "ignore"`, so the Claude session ran invisibly (or not at all) and the Overseer reported success because the spawn call returned. Multi-project flows (`dispatchAll`, `dispatchBatch`, `dispatchTeam`) require `tmux`, which is not installed natively on Windows and unsuitable under WSL2 (the 32GB-host / ~16GB-WSL ceiling crashes under multi-Claude load).

Phase 26 added a first-class Windows code path. macOS and Linux/WSL paths are byte-identical to pre-Phase-26.

## The flow

`lib/claude-dispatcher.ts:launchInTerminal()` branches on `detectPlatform()`:

- `"macos"` → `osascript -e 'tell application "Terminal" do script ...'` (unchanged)
- `"windows"` → `wt.exe -w 0 new-tab --title "<project>" --suppressApplicationTitle bash -c "<cmd>"`
- otherwise → `bash -c <cmd>` detached (Linux/WSL)

Windows specifics:

- **`-w 0`** targets the current Windows Terminal window if one is open and creates one otherwise. Repeated dispatches stack as tabs in the same wt window — single visual surface instead of N separate windows.
- **`--suppressApplicationTitle`** keeps the `--title` we set instead of letting bash overwrite it with the running command.
- **Shell = Git Bash** (`C:\Program Files\Git\usr\bin\bash.exe`, resolved via PATH). Preserves every existing dispatcher cmd string — `cd '<path>' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat 'tmpfile')" ; rm -f 'tmpfile'`. Bash quoting + env injection (`KEY='val' cmd`) works identically.
- **`fullscreen` parameter is ignored on Windows.** wt has no single-flag fullscreen toggle. F11 is one keystroke if the user wants it.

## Multi-project flows

`dispatchAll` and `dispatchBatch` use platform-aware shims around the tmux helpers (see `maybeKillTmuxSession`, `maybeCreatePaneGrid`, `launchForJob`, `maybeAttachTmuxSession`, `maybeFocusFirstPane`):

- On Windows: tmux ops are no-ops; `launchForJob` calls `launchInTerminal` per project, which opens one wt tab per project.
- On Linux/macOS: tmux ops run exactly as before; `launchForJob` calls `launchInPane` (tmux respawn) into the pre-created grid.

The dispatch queue still gates concurrency the same way. The visual model changes (tabs instead of grid panes) but the lifecycle is identical: Dispatch row → spawnFn → activity event → Stop hook.

## Agent teams

`claude --teammate-mode tmux` is hard-coupled to tmux at the Claude Code binary level. Phase 26 declines to half-implement; `dispatchTeam` on Windows returns:

```ts
{ success: false, error: "Agent teams require tmux — not supported on Windows. Use single dispatch or 'Resume All' instead." }
```

If a future Windows teammate-mode lands upstream, revisit.

## Preflight

`lib/dispatch-preflight.ts:checkDispatchPreflight()` returns `{platform, ok, missing[], tools{}}`. Required tools per platform:

| Platform | Tools |
|----------|-------|
| macos | `claude`, `osascript` |
| linux | `claude`, `tmux`, `bash` |
| windows | `claude`, `wt.exe`, `bash` |

Default `whichTool` shells out to `where.exe` on Windows, `which` everywhere else. Tests inject a fake `whichTool` via the `deps` argument so no subprocess fires under vitest. The dispatcher does not yet gate on the preflight result — Phase 26.D2 (future) is to fail dispatches with a clear "missing wt.exe" message instead of letting them try-and-fail.

## Required setup on a new Windows box

1. Install [Windows Terminal](https://aka.ms/terminal) — comes pre-installed on Windows 11.
2. Install [Git for Windows](https://git-scm.com/download/win) — gives you Git Bash at `C:\Program Files\Git\usr\bin\bash.exe`.
3. `npm i -g @anthropic-ai/claude-code` (puts `claude.cmd` on PATH).
4. If Node `fetch` to api.anthropic.com fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, your network does TLS interception. Add `NODE_OPTIONS=--use-system-ca` to `.env` so Node trusts the Windows cert store.

## Tests

- `lib/dispatch-preflight.test.ts` — 7 tests, all platforms.
- `lib/claude-dispatcher.windows.test.ts` — 5 tests, Windows path only (platform pinned via `vi.mock("./platform", () => ({detectPlatform: () => "windows"}))`).
- `lib/claude-dispatcher.multi.test.ts` and `tests/scenarios/{batch,dispatcher}-resilience.test.ts` pin platform to `linux` so the tmux scenarios they were written for still exercise the tmux path on a Windows host.

## Known gaps (future work)

- Multi-pane wt layout (split-pane within a tab) — tabs-per-project ships first, panes come if Justin asks.
- UI surface for `checkDispatchPreflight` — settings page badge / dashboard indicator. Currently the result is reachable only from code and tests.
- Pre-existing test failures on Windows that aren't dispatcher-related (anthropic-features-md, team-config-scanner, session-state route) — logged as `[26.D1]` in `audits/debt.md`.
