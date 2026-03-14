# S03: Runtime Steering — Research

**Date:** 2026-03-14

## Summary

S03 implements runtime steering — letting `labrat discuss` in a separate terminal write directives that the running `labrat auto` loop picks up at the next experiment boundary. The codebase analysis reveals that **every building block already exists and just needs assembly**: the atomic write-to-temp-then-rename pattern is proven in `agenda.ts` (D045), the `dispatchNextUnit` experiment boundary is the natural steering check insertion point (already hosts `checkAndAdvancePhase`), the `showPlan`/`buildPlanPrompt` command registration pattern is directly reusable, and the `pendingPlanAutoStart` stash pattern shows how to bridge interactive commands with the running loop.

The primary technical risk — concurrent file access between two processes — is mitigated by D041's write-to-temp-then-rename decision plus graceful JSON parse error recovery on the reader side. The `agenda.ts` `readAgendaState`/`writeAgendaState` pair is the direct template: `readSteeringDirective` and `writeSteeringDirective` follow the identical pattern.

The key constraint is **auto.ts at 3269 lines**. S02's forward intelligence warns it's at the limit. S03 must add ≤3 thin wiring calls to auto.ts (matching the D047 facade pattern) with all logic in a new `steering.ts` module. The `dispatchNextUnit` function already has the phase boundary check at line 1436 — steering check goes immediately before or after it in the same `experimenting` branch.

## Recommendation

**Follow S01/S02's module extraction pattern exactly.** Create `steering.ts` with pure functions for read/write/clear of `STEERING.json`, plus a facade function `checkSteeringDirective()` that `dispatchNextUnit` calls. For the `labrat discuss` command: register in `commands.ts`, implement `showSteering()` in `guided-flow.ts` (adapting the `showPlan` pattern), and create a `steer-campaign.md` prompt template. The command does NOT need `dispatchWorkflow` — steering is simpler than plan: it writes a small JSON file and exits with a latency message. It can be a direct interactive flow using `ask_user_questions` or LLM-assisted, depending on complexity preferences.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Atomic file writes | `writeAgendaState` pattern in `agenda.ts` (temp + rename, D045) | Proven crash-safe, same POSIX guarantees needed for STEERING.json |
| Graceful JSON parse recovery | `readAgendaState` pattern in `agenda.ts` (try/catch, stderr warning, return null) | Same corrupt-file resilience needed for STEERING.json reader |
| Command registration | `commands.ts` subcommand routing + `guided-flow.ts` handler pattern | Plan subcommand (line 154) is the exact template |
| Experiment boundary hooks | `checkAndAdvancePhase` call site in `dispatchNextUnit` (line 1436-1439) | Steering check goes in the same block, same pattern |
| Facade function for auto.ts | `checkAndAdvancePhase` / `getPhasePromptOverrides` / `stampPhaseIndex` (D047) | Same thin-call pattern keeps auto.ts line count stable |
| Type definitions | `types.ts` + re-export from module (agenda.ts convention) | `SteeringDirective` type follows same pattern |
| Prompt template | `plan-agenda.md` with `{{variable}}` substitution via `loadPrompt` | `steer-campaign.md` follows same template+load pattern |

## Existing Code and Patterns

### Core Insertion Points

- `src/resources/extensions/gsd/auto.ts` line 1425–1439 — **Primary steering insertion point.** The `experimenting` phase branch in `dispatchNextUnit` already has `checkAndAdvancePhase`. Steering check should go here — either before phase check (steering can override phase direction) or after (phase advance is structural, steering is user intent). Recommendation: **before phase check**, so a `skip_phase` directive can preempt the normal phase boundary detection.

- `src/resources/extensions/gsd/auto.ts` line 595–665 — **`handleAgentEnd` function.** Runs after each experiment completes. This is where experiment post-processing (eval, keep/discard, phase stamping) happens. Steering does NOT go here — it goes in `dispatchNextUnit` which fires after `handleAgentEnd` completes. The flow is: `handleAgentEnd()` → eval → keep/discard → `dispatchNextUnit()` → steering check → phase check → build prompt → dispatch.

### Module Template

- `src/resources/extensions/gsd/agenda.ts` — **Direct structural template for `steering.ts`.** Both modules: define types in `types.ts`, re-export from module, provide atomic read/write/state functions, expose facade functions for auto.ts. `readAgendaState`/`writeAgendaState` → `readSteeringDirective`/`writeSteeringDirective`. `checkAndAdvancePhase` → `checkSteeringDirective`.

- `src/resources/extensions/gsd/simplicity-scorer.ts` — **Simpler structural template.** Pure functions, no state, no facade. Steering module is closer to agenda.ts in complexity (has state I/O) but simplicity-scorer shows the minimal viable module shape.

### Command Registration

- `src/resources/extensions/gsd/commands.ts` line 149–152 — **`discuss` subcommand handler.** Currently calls `showDiscuss()` for slice interviews. The runtime steering `discuss` command needs a DIFFERENT flow — it doesn't do a slice interview, it writes a steering directive. Options: (a) add a new subcommand name like `steer`, (b) make `discuss` context-aware (if auto-mode is running → steering flow, otherwise → slice interview), or (c) add `discuss` as a steering-aware variant. Recommendation: **option (b)** — `discuss` becomes context-aware. When auto-mode is running AND there's an active campaign, route to steering flow. Otherwise, existing `showDiscuss()` behavior.

- `src/resources/extensions/gsd/commands.ts` line 56–59 — **Subcommand list.** Currently: `["next", "auto", "stop", "status", "queue", "discuss", "plan", "prefs", "doctor", "migrate", "remote", "report"]`. The `discuss` subcommand already exists — we're enriching its behavior, not adding a new one.

### Interactive Flow

- `src/resources/extensions/gsd/guided-flow.ts` line 402–504 — **`showPlan` function.** Guard checks (GSD project, milestone, campaign), slice picker, prompt build, dispatch. For steering: similar guards plus auto-mode running check. But steering is lighter — it doesn't need LLM decomposition, it needs: (1) what kind of steering? (2) what message? (3) write STEERING.json → print latency notice.

- `src/resources/extensions/gsd/guided-flow.ts` line 592–662 — **`showDiscuss` function.** Full multi-round LLM interview flow. Steering could optionally use LLM assistance to formulate a well-structured directive, or it could be a simpler `ask_user_questions` → `writeSteeringDirective` → "Will take effect after current experiment" flow.

### State Files

- Slice directory `AGENDA-STATE.json` — Steering reads this to understand current phase for `skip_phase` and `refocus` directives.
- Slice directory `CAMPAIGN.json` — Steering reads this to understand campaign context (research question, target files, metrics).
- Slice directory `EXPERIMENT-LOG.jsonl` — Steering may optionally summarize recent results to help the user formulate a directive.

### Test Patterns

- `src/resources/extensions/gsd/tests/agenda.test.ts` — **106 assertions.** Pattern: temp directory, pure function calls, `assert`/`assertEq`, cleanup. `steering.test.ts` follows same pattern for read/write/clear functions.
- `src/resources/extensions/gsd/tests/plan-command.test.ts` — **45 assertions.** Tests prompt assembly, command guards, agenda validation. `steering-command.test.ts` follows same pattern for discuss-steering prompt assembly and guards.

## Constraints

- **auto.ts at 3269 lines — hard limit ~3270.** S02 forward intelligence warns this is at the limit. S03 must not add more than a few lines (import + facade call). All steering logic in `steering.ts`. Target: 1 import line, 1–3 call site lines in `dispatchNextUnit`.

- **Experiment boundaries are the ONLY safe intervention points.** Steering can never interrupt a running experiment. The check happens in `dispatchNextUnit` between experiments. The `handleAgentEnd` → `dispatchNextUnit` flow guarantees the previous experiment is fully processed (eval, keep/discard, phase stamp) before steering is evaluated.

- **Two processes access the same file.** `labrat auto` (process A) reads `STEERING.json`; `labrat discuss` (process B) writes it. Node.js `writeFileSync` is NOT atomic — a partial write produces invalid JSON. The write-to-temp-then-rename pattern (D041) solves this on POSIX systems. The reader must also handle: (a) file doesn't exist (normal — no steering), (b) file is empty/corrupt (race condition — return null, try next time), (c) file is valid JSON (apply directive).

- **`STEERING.json` is consumed-then-deleted.** After the running loop applies a directive, it deletes the file (or marks it as applied). This prevents re-application on restart. Pattern: read → apply → `clearSteeringDirective` (delete or rename to `.applied`).

- **Backward compatibility.** Non-agenda campaigns must work with steering too (the `refocus` and `stop` types don't require an agenda). `skip_phase` and phase-aware steering require an agenda — these should gracefully degrade (ignore or warn) for non-agenda campaigns.

- **The `discuss` subcommand already exists** for slice interviews. The runtime steering flow needs to coexist — either via context-aware routing (is auto-mode running?) or a different subcommand name.

- **`isAutoActive()` and `isAutoPaused()` are exported from auto.ts** — these can be used to detect whether steering should route to the runtime steering flow or the existing discuss flow.

## Common Pitfalls

- **Growing auto.ts beyond the limit** — The natural temptation is to add steering logic inline in `dispatchNextUnit`. Instead, package everything as a single `checkSteeringDirective(sliceDir, agenda, ctx)` facade call in `steering.ts` that returns a notification message (or null). auto.ts gets one line: `const steeringMsg = checkSteeringDirective(sliceDir, config); if (steeringMsg) ctx.ui.notify(steeringMsg, "info");` — matching the `checkAndAdvancePhase` pattern exactly.

- **Steering latency confusion** — User writes a directive at 2:05 PM, experiment completes at 2:15 PM, steering takes effect at 2:15 PM. The 10-minute gap is confusing. **Mitigation:** `labrat discuss` must print "Steering directive written. Will take effect after the current experiment finishes." immediately after writing. Also consider: touch a separate `.steering-pending` marker that the running loop's UI can display ("Steering directive pending — will apply after current experiment").

- **Not clearing the directive after application** — If `STEERING.json` is not deleted after application, every subsequent experiment boundary re-reads and re-applies it. The `clearSteeringDirective` function must be called immediately after successful application.

- **`skip_phase` on non-agenda campaign** — A `skip_phase` directive on a campaign without an agenda is meaningless. Must check `config.agenda` before applying phase-level directives and warn if not applicable.

- **Partial write race on reader side** — Even with temp+rename for writes, the reader could theoretically read during the rename. On POSIX, `rename()` is atomic — the reader sees either the old file or the new file, never a partial. But if `readFileSync` is called on the temp file before rename completes... this can't happen because the reader reads the target path, not the temp path. The temp+rename pattern is safe.

- **`labrat discuss` in the same terminal as `labrat auto`** — Both `discuss` and `auto` are `/gsd` subcommands in the same pi process. The steering `discuss` flow needs to work when auto-mode is running IN THE SAME PROCESS (writes STEERING.json to disk, loop picks it up at next boundary) OR from a SEPARATE terminal/process. Both cases work identically because the IPC mechanism is the filesystem.

## Open Risks

- **Steering directive type granularity** — The spec defines `refocus | skip_phase | add_experiments | stop`. `refocus` is clear (change experiment direction). `skip_phase` is clear (advance to next phase). `stop` is clear (halt campaign). `add_experiments` is ambiguous — does it modify `maxExperiments` in CAMPAIGN.json? Does it add to the current phase? This needs a clear policy. Recommendation: defer `add_experiments` or implement it as "increase maxExperiments by N" with a warning that CAMPAIGN.json is modified.

- **Steering + phase advance interaction** — If a `skip_phase` directive arrives just as the loop would naturally advance to the next phase (both happening at the same experiment boundary), which takes precedence? The steering check should run BEFORE `checkAndAdvancePhase` — if steering says `skip_phase`, it calls `advancePhase()` directly and the natural phase check becomes a no-op (already advanced).

- **Multiple steering directives before pickup** — User writes directive A, then writes directive B before A is consumed. B overwrites A (file replacement). This is the correct behavior — latest directive wins. But should we warn the user? "Note: a previous steering directive was pending and will be replaced."

- **LLM-assisted vs. direct steering** — The `labrat discuss` command could either (a) use the LLM to help formulate a steering directive (rich, but slower and costs tokens) or (b) use `ask_user_questions` for direct type selection + message input (fast, free, deterministic). Recommendation: start with (b) for the contract test path, add (a) as an enhancement if needed. The spec says "interactive prompt that writes STEERING.json" — this could be either.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Node.js atomic file writes | (searched) | none found — using POSIX temp+rename pattern from D041/D045 |
| TypeScript state machine | (searched in M002 research) | none found — domain-specific |

## Sources

- Codebase: `auto.ts` (3269 lines), `agenda.ts` (369 lines), `types.ts` (297 lines), `commands.ts` (588 lines), `guided-flow.ts` (1081 lines), `index.ts` (690 lines), `simplicity-scorer.ts` (85 lines)
- Tests: `agenda.test.ts` (608 lines, 106 assertions), `agenda-execution.test.ts` (494 lines, 61 assertions), `plan-command.test.ts` (264 lines, 45 assertions)
- Prompts: `run-experiment.md` (80 lines), `plan-agenda.md` (185 lines)
- S02 summary: forward intelligence on auto.ts line count, facade pattern, insertion points
- Decisions: D039 (module extraction), D041 (atomic steering writes), D044 (phase in dispatchNextUnit), D045 (atomic agenda writes), D047 (facade functions)
- M002 roadmap: S03 boundary map, success criteria, risk analysis
