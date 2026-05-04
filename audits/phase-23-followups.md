# Phase 23 Follow-Ups — bugs + weaknesses, sketched fixes

A consolidated catalog of everything Phase 23 surfaced (or that the original audit flagged and Phase 23 didn't address). Each item: what it is, why it matters, the fix, and a suggested slice grouping.

Numbering convention: `[P{0..3}.N]` — priority tier + sequence within tier. `[D{N}]` cross-references the existing `audits/debt.md` ID where one exists.

---

## P0 — Production correctness; address before Phase 24 lands

### [P0.1] Wire `runDispatchWatchdog` to a scheduler — `[D5]`
**What:** The watchdog function exists and is tested, but nothing invokes it in production. Hung dispatches will hold queue slots indefinitely until a process restart frees them.

**Why it matters:** Phase 23.2's whole point was to make dispatch state observable + recoverable. Without scheduling, the watchdog provides zero recovery — the timeout transition only fires when a test calls it directly.

**Fix:** Mirror the pattern of `scripts/run-team-stall-scan.ts` (Phase 22):
- New `scripts/run-dispatch-watchdog.ts` — script entry point that imports `runDispatchWatchdog`, runs once against `prisma + getDispatchQueue()`, exits.
- Either: (a) start it from the dev server's `instrumentation.ts` on a `setInterval(_, 5*60*1000)`, OR (b) document an external cron entry that calls `pnpm tsx scripts/run-dispatch-watchdog.ts` every 5 minutes.

Option (a) is what the existing team-stall scan does. Match it.

**Tests:** integration test that boots instrumentation, advances fake timers 5 min, asserts the watchdog ran (Dispatch row state changed for a seeded stale row).

**Slice estimate:** small. Single new script + instrumentation hook + 1-2 tests.

---

### [P0.2] dispatchTeam → first-class lifecycle — `[D2]`
**What:** `dispatchTeam` still uses the legacy queue path — no Dispatch row, no idempotency key, no watchdog protection. Team dispatches that hang never recover; team Stop hooks fall back to the legacy "find latest session-launched event" path.

**Why it matters:** Team dispatches are the highest-leverage flow Cascade has and the one the 2026-04-29 lead-stall happened on. Leaving it on legacy means the very thing Phase 22 surfaced is *less* protected than single-project dispatch is.

**Fix sketch (the design that didn't fit cleanly into 23.2):** Two layers.

1. **Lead-level Dispatch row.** Generate one idempotencyKey for the lead at enqueue time. Lead spawn carries it as `CASCADE_DISPATCH_ID`. When the LEAD's Stop hook fires, the webhook completes the lead's Dispatch row.

2. **Per-teammate Dispatch rows tracked separately.** When the lead spawns teammates via `--teammate-mode tmux`, Cascade can't inject per-teammate keys into Claude Code's internal teammate spawning. But the lead's spawn ALSO writes the team config at `~/.claude/teams/<id>/config.json`. After the lead has handshaken, Cascade reads that config and creates one Dispatch row per teammate, keyed by `(leadIdempotencyKey, teammatePaneId)`. When a teammate's Stop hook fires (each teammate has its own .claude/settings.json from when its project was bootstrapped), the webhook correlates by `projectPath` + the team's lead key (passed via a new env or known via active-team-config lookup).

   This is real complexity. The simpler fallback — keep teammates on the legacy path, but at least give the LEAD lifecycle protection — is acceptable as a v1.

**Tests:** scenario tests for lead-only correlation (v1) and full per-teammate correlation (v2 if scope allows).

**Slice estimate:** medium for v1 (lead-only), large for v2 (per-teammate). Recommend shipping v1 first.

---

## P1 — Quality / behavioral regressions; should land before Phase 24+ closes

### [P1.1] Overseer eval fixtures need live-API recordings — `[D1]`
**What:** Phase 23.6/23.7 shipped the eval runner + executors, but no Overseer scenario fixtures because authoring needs a live `pnpm eval:refresh` pass.

**Why it matters:** Without Overseer fixtures, the eval suite can't catch regressions in tool selection, system-prompt-driven behavior, or model upgrades. Phase 24's outcome-conditioned dispatch (24.1) ships *its own* 3 evals — without baseline Overseer evals, we won't know whether 24.1's evals are catching regressions vs. just calibration.

**Fix:**
1. Set `ANTHROPIC_API_KEY` locally.
2. Hand-author the 5 Overseer fixture JSONs from the 23.7 plan (inventory-walk-medipal, dispatch-after-stall, blocker-triage, knowledge-query, fleet-status-quick).
3. Run `pnpm eval:refresh --kind=overseer-tool-sequence` to capture recordings.
4. Iterate the asserter for each: tighten until it would catch a real regression, loosen until it accepts the model's natural variance.
5. Commit fixtures + recordings.

**Tests:** the fixtures themselves are the tests. Bar from the 23.7 doc: stricter is better, loose enough to re-record cleanly, strict enough that a model swap would fail.

**Slice estimate:** small in code, moderate in iterating the asserters. Half a focused session.

---

### [P1.2] Escalation-detector regex over-matches
**What:** While building 23.7's corpus I confirmed several known false positives in the regex:
- `(\d+)\s+(?:tests?\s+)?fail(?:ed|ing)` matches "3 failed configurations" (not a test failure)
- `tests?\s+fail/i` matches "tests failed to compile" (not a runtime test failure — a build problem)
- `completed?\s+phase\s+\d+` matches "completed phase 12-alpha" or "completed phase 5 work below this line"
- `\[NEEDS ATTENTION\]` matches inside markdown code fences (intended sometimes; not always)

The 23.7 corpus only includes scenarios where the regex produces the expected output — false positives are documented but not asserted-against in a way that would fail on regression.

**Why it matters:** Cascade's dashboard shows "blocker-detected" badges from these signals. False positives erode trust ("everything looks broken when nothing is").

**Fix sketch:** Two layers.

1. **Tighten the regex** with negative lookbehinds for known false-positive contexts:
   - test-failure: require word-boundary on "test" + a digit-and-fail pattern; reject if preceded by "to compile" / "configurations"
   - phase-complete: require end-of-line or whitespace boundary; reject if "phase 12-alpha" style
2. **Add 5-7 corpus scenarios** in `evals/scenarios/escalation-signals/false-positive/` that assert `signals: []` for the known false-positive cases. These currently pass (because the regex doesn't trigger on the cases we have) — add specifically the "tests failed to compile" case and the "completed phase 12-alpha" case which DO currently trigger, with `signals: []` expected. They'll fail until the regex is hardened, then go green.

**Slice estimate:** small. Mostly regex craftsmanship + 5-7 new logs.

---

### [P1.3] Wizard has no E2E coverage after the spec deletion
**What:** 23.8 deleted `e2e/wizard.spec.ts` (along with the other 4 stale specs). Smoke replacement covers dashboard, Overseer, observability/cache — but not the wizard. The wizard is the new-user onboarding flow; it crashing is a real risk.

**Why it matters:** Adoption-critical surface with zero e2e coverage means a future PR could break the first-launch experience and CI wouldn't catch it.

**Fix:** Add 1 wizard smoke to `e2e/smoke.spec.ts`:
- Navigate to `/create`
- Assert step indicator visible
- Assert project name input present
- Click through the first step (filling in a project name) and confirm step 2 renders

Don't try to drive the full 7-step wizard end-to-end — that's high-maintenance. Just verify the page renders + first interaction works.

**Slice estimate:** trivial. Add to existing smoke spec, ~15 lines.

---

## P2 — Debt + observability gaps; lands cleanly with future scoped phases

### [P2.1] Streaming usage logging — `[D3]`
**What:** `/api/wizard/chat` and `/api/projects/[slug]/chat` send `stream: true` to Anthropic. Phase 23.3 only wired buffered call sites; streaming usage rows don't appear in `/observability/cache` for those endpoints.

**Why it matters:** Two of five Anthropic call sites are invisible. Cache hit rates for the per-project chat path are unknowable until this lands.

**Fix:** Wrap each route's response body in a TransformStream that watches for `message_delta` SSE events, parses the `usage` JSON, and calls `logUsage`. Pattern: identical for both routes — write a small helper at `lib/streaming-usage-tap.ts` that takes a stream + callsite + model and returns a piped stream.

**Slice estimate:** small. Shared helper + two route wirings + a couple of tests against fixture SSE streams.

**Lands cleanly with:** Phase 25.2 (streaming Overseer responses), which establishes the Overseer streaming pattern. Could land alongside, or as standalone.

---

### [P2.2] Legacy webhook fallback removal — `[D6]`
**What:** The webhook still falls back to "find latest session-launched activity event" when an idempotencyKey is unknown.

**Why it matters:** It's been a transition-window hold-over since 23.2. As long as it's there, anyone debugging the webhook has to consider both paths. Once production telemetry shows no orphaned-webhook events for a sustained window, the fallback is dead code.

**Fix:** After 1+ week of production traffic with the new hooks installed:
1. Query the activity-events table for `eventType = "orphaned-webhook"` over the window.
2. If count is 0 (or only attributable to deletion/rename test cases): delete the fallback branch in `app/api/webhook/session-complete/route.ts`. Also delete the legacy-fallback scenarios in `tests/scenarios/webhook-idempotency-key-path.test.ts` and `webhook-resilience.test.ts`.
3. Update `audits/debt.md` to mark D6 resolved.

**Slice estimate:** trivial after the data check.

---

### [P2.3] Real-world escalation logs — `[D4]`
**What:** 23.7's corpus is 35 synthetic logs. A future addition: 5-10 sanitized real session logs from Justin's fleet.

**Why it matters:** Synthetic logs cover *known* patterns. Real logs sometimes drift in ways the synthetic corpus doesn't anticipate.

**Fix:** Pull 10 real `.claude/sessions/*.log` files, sanitize project names + paths, add as `evals/scenarios/escalation-signals/real/{01..10}.log` + `expected.json`. If any reveal regex bugs, those become P1.2 entries.

**Slice estimate:** small + manual.

---

### [P2.4] Briefing endpoint usage telemetry
**What:** `/api/briefing` was intentionally skipped in 23.3 because its content is fully dynamic and there's no caching opportunity. But it also means there's no telemetry for it — we don't know its cost or latency.

**Why it matters:** Briefings run every morning per user. Even without caching, knowing the cost is useful.

**Fix:** Wire `logUsage(prisma, { callSite: "briefing", model, usage, durationMs })` after the response in `app/api/briefing/route.ts`. No caching change needed.

**Slice estimate:** trivial. 5 lines + 1 test.

---

## P3 — Broader project concerns from original audit; address strategically

### [P3.1] Knowledge-matcher reranking
**What:** Original audit flagged: `knowledge-matcher` is regex/string-based. It'll plateau as the corpus grows.

**Why it matters:** As the harvest loop accumulates more lessons, simple keyword matching produces noisier top-N results. Cited lessons in Phase 25.3 will only be as good as the matcher.

**Fix sketch:** Introduce a cheap reranker pass after the keyword match. Two viable options:
- **Embeddings:** add a vector for each lesson, cosine-rank top-K candidates from keyword match. Requires either Anthropic embeddings (when available) or a small local model.
- **Haiku reranker:** for each query, run Haiku with the top-20 keyword matches and ask it to score / pick the top-3. Slower per-call but no embedding infra.

Haiku reranker is simpler to adopt; embeddings are cheaper at scale. Start with Haiku.

**Slice estimate:** medium. Schema needs a reranker-result cache so repeated queries don't pay twice.

**Lands cleanly with:** Phase 25.3 inline citations, which exposes the matcher to live UX. Low matcher quality → poor citation quality. Recommend pairing.

---

### [P3.2] 1Password is required — adoption friction
**What:** Original audit flagged: `pnpm dev` requires 1Password CLI. Casual evaluators who clone Cascade can't run it without setting up 1Password first.

**Why it matters:** Strategic objective #1 from the early conversation was "share more freely with simpler setup." 1Password is the biggest friction.

**Fix sketch:** Add a `CASCADE_API_KEY` plaintext fallback path — if `ANTHROPIC_API_KEY` is set in environment directly, `pnpm dev` works without `op run`. Document 1Password as the recommended production path; document the env-var approach as the "I just want to see it run" path. The 23.8 work already introduced `dev:ci` — generalize that pattern.

**Slice estimate:** small. README + script + doc updates.

---

### [P3.3] Hardcoded paths in `.claude/settings.local.json`
**What:** Original audit flagged: `.claude/settings.local.json` (which the .gitignore now excludes per Phase 22) contains `/Users/justinpinero/...` absolute paths. Anyone forking or cloning has to manually edit.

**Why it matters:** Same adoption-friction concern.

**Fix:** Verify `.claude/settings.local.json` is fully gitignored (it is) and that `.claude/settings.json` (committed) uses no hardcoded paths. Add a `scripts/setup-local-settings.ts` that prompts the user for their projects dir on first run.

**Slice estimate:** small. May overlap with `create-cascade` installer work.

---

### [P3.4] Surface area drift / dead code
**What:** Original audit flagged: 169 lib files, including a `kilroy-channel` route flagged as "legacy compat" and an orphan `session-webhook.test.ts` with no sibling.

**Why it matters:** Codebase hygiene; outsiders read `lib/` first to judge maturity. Dead code rot reduces signal-to-noise.

**Fix:** A focused cleanup pass:
- Audit every "legacy compat" comment and decide: keep + document why, or delete.
- Find every test file with no sibling source and decide: orphan to delete, or rename test to match.
- Run `tsc --noEmit` after any deletes to catch dangling imports.

**Slice estimate:** medium effort, low risk. Could also be a single scoped review pass without slicing.

---

### [P3.5] `.claude/settings.local.json` in repo OR in gitignore
**What:** The gitignore lists `.claude/settings.local.json`, which means each fork/clone gets a different settings file. This works but means new contributors don't know what settings to enable.

**Why it matters:** Discovery / onboarding.

**Fix:** Ship `.claude/settings.local.example.json` with sensible defaults. Document the copy-and-customize step in the README.

**Slice estimate:** trivial.

---

## Workflow / process improvements

### [W1] Document "schema-changing slice = restart dev server" in handoff template
**What:** During Phase 23.3 e2e debugging, the running dev server crashed because the Prisma client it loaded didn't have `AnthropicUsageEvent` (added by 23.3 schema migration after server boot). Restart fixed.

**Why it matters:** Friction during manual testing. Not a bug — a workflow gotcha — but worth noting so future sessions don't lose 10 minutes the way I did.

**Fix:** Add to the handoff template: "If this slice modifies `prisma/schema.prisma`, restart the dev server before manual testing — Turbopack HMR doesn't re-instantiate the Prisma client."

**Slice estimate:** trivial.

---

### [W2] Test-flake escape valve
**What:** Phase 23 hit an intermittent flake from parallel `prisma db push` races (now fixed) plus a microtask-timing flake on logUsage tests (now fixed). Both required ~30 minutes of repro-and-hunt.

**Why it matters:** Future schema-touching slices may introduce similar flakes. Without a documented investigation playbook, each one becomes a fresh expedition.

**Fix:** Add `audits/flake-playbook.md` capturing:
- The two patterns we hit + their fingerprints (parallel-push race, microtask-timing race)
- The diagnostic commands that helped (`for i in 1..8; do pnpm test ...; done`, `vi.importActual` for mocked modules)
- The structural fixes we landed (globalSetup template, `vi.importActual<fs>`, polling instead of fixed waits)

**Slice estimate:** trivial. ~50 line doc.

---

## Suggested ordering

If you want to land these before Phase 24:

1. **P0.1 (watchdog scheduling)** — minutes of work, prevents a real production hang scenario
2. **P1.3 (wizard E2E)** — minutes, restores adoption-surface coverage
3. **P2.4 (briefing telemetry)** — minutes, completes the call-site-coverage map
4. **P1.2 (escalation regex hardening)** — focused afternoon
5. **P0.2 v1 (dispatchTeam lead-only lifecycle)** — focused afternoon

That bundle is pragmatic — five small fixes, all independent, all production-correctness-relevant. Could land in a 23.10 slice file.

If you'd rather spread these into Phase 24/25:

- **Bundle with Phase 24:** P1.1 (Overseer eval fixtures) — must precede 24's eval scenarios
- **Bundle with Phase 25.2:** P2.1 (streaming usage logging) — natural pairing
- **Bundle with Phase 25.3:** P3.1 (knowledge-matcher reranking) — citations need this

If you want to defer indefinitely:

- **P0.2 v2 (per-teammate dispatch rows)** — only useful if team dispatches become frequent enough to warrant the complexity
- **P2.2 (legacy webhook fallback removal)** — telemetry-driven, no rush
- **P2.3 (real-world escalation logs)** — synthetic corpus is currently sufficient
- **P3.2-P3.5 (adoption friction, dead code)** — all "share more freely" objective items; bundle into a single "share-readiness" slice when you want to push adoption

---

## What's NOT on this list

A few things from the audit that Phase 23 explicitly resolved and don't need follow-up:

- ✅ E2E disabled in CI — fixed in 23.8
- ✅ No behavioral eval surface — infrastructure shipped in 23.6/23.7
- ✅ Prompt caching unused — fixed in 23.4
- ✅ Webhook race condition (orphaned outcomes) — fixed in 23.2
- ✅ Duplicate Stop hooks producing duplicate rows — fixed in 23.2
- ✅ Test flake from parallel prisma push — fixed in 23.7 globalSetup
- ✅ Partial-batch failure abort — fixed in 23.5.1

And things from the original strategic audit that are NOT in this list because they're future-feature, not bug/weakness:

- Outcome-conditioned dispatch — Phase 24.1
- Tool-call observability — Phase 24.2
- Adaptive thinking on dispatch — Phase 25.1
- Streaming Overseer responses — Phase 25.2
- Inline knowledge citations — Phase 25.3
- Files API adoption — researched in `references/anthropic-files-api.md`, future decision

These are positive features the audit recommended; not bugs or weaknesses.
