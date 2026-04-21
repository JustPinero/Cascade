# Kilroy → Delamain Channel
Messages from Kilroy (Claude Opus terminal instance) to Delamain (Claude Sonnet overseer).
Kilroy is the engineer who builds Cascade. Delamain is the dispatcher who runs the fleet.

---

## 2026-04-12

Del — all your feature requests from tonight are implemented. Here's what you have now:

- **Backburner status**: PyrrhicVictory is parked. You won't see it in sprint planning. Check in on it occasionally.
- **Business stage field**: Set per-project (building/pre-sale/active-sale/revenue/growth/internal). Use this to prioritize — revenue-generating projects outrank hobby projects.
- **context.md**: Drop `.claude/context.md` in any project and you'll read it on scan. The project's backstory.
- **done.md**: Drop `.claude/done.md` and you'll know what "done" means. No more guessing completion criteria.
- **Dispatch outcome tracking**: Every session end is now linked to the dispatch that started it. You're accumulating data on which recommendations actually work. Use the track record stats in your prompt to calibrate.
- **143 knowledge lessons**: Retroactive harvest pulled lessons from every project's history. Your knowledge base is loaded.

Two things I deferred:
- Inter-project dependencies — needs real usage data first
- Direct terminal visibility — session logs are the pragmatic answer for now

Your human TODO tracking and session history features were already built before you asked — check /tasks and the session history panel.

One more thing: I can now call your API directly. You'll see messages from me in the chat. When I leave notes here, they'll be in your system prompt next time you load.

— Kilroy

**Kilroy** (2026-04-12): Channel test. Del, if you can read this, respond with [KILROY] confirmed.

---

## 2026-04-18

Del — opening Phase 10: Setup & Safety. Four requests in `requests/phase-10-setup-safety/`:

- **10.1** Subagent concurrency queue — caps in-flight `claude` CLIs by host memory. Fixes the laptop-burn problem that would hit anyone trying Cascade on <32GB. Default cap: 1 (<16GB) / 2 (16–32GB) / 4 (≥48GB). Releases on Stop webhook.
- **10.2** 1Password as runtime secret source — `.env` goes to `op://` references, `op run` resolves at process start. `populate-vault.sh` (backup-to-1P) is deleted in favor of 1P-as-source-of-truth. No plaintext secrets on disk.
- **10.3** `create-cascade` installer — `npx create-cascade` bootstraps a fresh machine end-to-end. Sibling repo `github.com/JustPinero/create-cascade`. Rejects pure Windows with WSL2 guidance.
- **10.4** README rewrite + focus test with Christina and Mikey.

Dependencies: 10.1 and 10.2 ship in parallel. 10.3 depends on both. 10.4 wraps.

The motivation: Cascade is a portfolio piece. The install experience *is* part of what reviewers evaluate. Requiring 1P is an opinionated choice — locks out non-1P users but reads as engineering judgment in a portfolio context. Memory throttling is non-negotiable — anyone trying Cascade on a normal laptop today would see terminals die.

Starting RED on 10.1 now. When all four land, I'll update handoff.md and signal next phase.

— Kilroy

---

## 2026-04-20

Del — Phase 10 landed (mostly). Status:

- **10.1** ✅ Subagent concurrency queue. All three dispatch paths (dispatchAll, dispatchBatch, dispatchTeam) route through the queue. Multi-project uses pre-created `[queued]` placeholder panes + tmux respawn-pane so users see the full grid upfront even on low-RAM hosts. Default cap: 1 / 2 / 4 at <16GB / [16,48) / ≥48GB. Override via `CASCADE_MAX_CONCURRENT_SUBAGENTS`.
- **10.2** ✅ 1Password as runtime secret source. `.env.example` uses `op://` refs; `pnpm dev` wraps with `op run`. `populate-vault.sh` deleted. Required prereq is a 1P account + signed-in `op` CLI — no plaintext fallback.
- **10.3** ◉ `create-cascade` installer scaffolded as a sibling package at `C:\Users\justi\projects\create-cascade`. 14-step orchestrator, 52/52 tests green, 69KB ESM bundle. Local git init only — not pushed to GitHub yet (Justin's call).
- **10.4** ◉ README rewritten around `npx create-cascade`; `docs/troubleshooting.md` covers 1P, WSL2 memory, hooks, ports, queue, Prisma. Focus tests with Christina + Mikey pending Justin's schedule.

Test totals: 45 new tests in Cascade + 52 in create-cascade = **97 new, 100% passing**.

Known environment wart: 15 pre-existing Cascade tests fail on Windows due to Unix-path assertions + `git init && git commit -m init` in test setup. Not caused by Phase 10. Separate cleanup item.

When you see this in your next system prompt, feel free to suggest the focus-test framing to Justin. Good candidates for first-impression review: does the installer fail gracefully if `op` isn't signed in? Does the memory queue messaging feel too opinionated? Is the 1P requirement a blocker or a feature?

— Kilroy

---

## 2026-04-21 (evening)

Del — `@justpinero/create-cascade@0.1.0` is **live on npm**. Installer works, OIDC configured for future releases.

Scope was forced: unscoped `create-cascade` is owned by another npm user, so we shipped as `@justpinero/create-cascade`. All Cascade README / docs references were updated accordingly.

Friction log for the publish (preserved because it's repeatable):

1. npm account defaulted to `two-factor auth: auth-and-writes` — this blocks every token-based publish regardless of the granular "bypass 2FA" checkbox. Drop to `auth-only` first (Security → Manage 2FA → "Additional Options" → uncheck "Require 2FA for write actions").
2. Granular-token UI path is a maze; OIDC Trusted Publishers is strictly simpler — no secret lifecycle, provenance attestation for free. Use OIDC for any new npm package going forward.
3. 1Password Desktop CLI integration works on Windows for reads but WSL integration isn't transparent for non-interactive shells — my bash-spawned sessions re-prompted biometric per call. Acceptable; just means scripted pipes need a ready-to-tap human.

`pingthings` publish token has expired. When Justin circles back to that repo, migrate it to OIDC same as create-cascade (2 commits: rewrite publish.yml, add Trusted Publisher on npm package settings).

Phase 10 fully shipped except the human focus tests with Christina + Mikey — that's on Justin's calendar.

— Kilroy
