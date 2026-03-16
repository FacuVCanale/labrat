/**
 * Hypothesis Dispatch Wiring — Contract Tests
 *
 * Tests: unit type selection, artifact paths, switch-site coverage,
 * backward compat, results persistence format.
 * Created in T01 as skeleton; T02 fills with remaining assertions.
 */

import { strict as assert } from 'node:assert';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// We test the exported functions from auto.ts by importing them directly.
// These are pure functions that don't need the full runtime.
import { resolveExpectedArtifactPath } from '../auto.js';
import { parseCampaignConfig } from '../state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const gsdRoot = join(__dirname, '..');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

function assertInc(condition: boolean, msg: string): void {
  if (condition) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ─── Helper: create temp .gsd structure for resolveExpectedArtifactPath ──────

function createTempGsd(): { base: string; sliceDir: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), "hyp-dispatch-"));
  const sliceDir = join(base, ".gsd", "milestones", "M001", "slices", "S01");
  mkdirSync(sliceDir, { recursive: true });
  return { base, sliceDir, cleanup: () => rmSync(base, { recursive: true }) };
}

// ─── resolveExpectedArtifactPath — actual function calls ─────────────────────

test("resolveExpectedArtifactPath: research-hypothesis → HYPOTHESIS-RESEARCH.md", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("research-hypothesis", "M001/S01", base);
  assert.ok(result);
  assertInc(result!.endsWith("HYPOTHESIS-RESEARCH.md"), "path ends with HYPOTHESIS-RESEARCH.md");
  assertInc(result!.includes("S01"), "path contains slice S01");
  cleanup();
});

test("resolveExpectedArtifactPath: plan-hypothesis → EXPERIMENT-NNN-PLAN.md", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("plan-hypothesis", "M001/S01/E002/plan", base);
  assert.ok(result);
  assertInc(result!.endsWith("EXPERIMENT-2-PLAN.md"), "path ends with EXPERIMENT-2-PLAN.md");
  cleanup();
});

test("resolveExpectedArtifactPath: plan-hypothesis defaults to E001", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("plan-hypothesis", "M001/S01", base);
  assert.ok(result);
  assertInc(result!.endsWith("EXPERIMENT-1-PLAN.md"), "path ends with EXPERIMENT-1-PLAN.md");
  cleanup();
});

test("resolveExpectedArtifactPath: execute-hypothesis → EXPERIMENT-LOG.jsonl", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("execute-hypothesis", "M001/S01", base);
  assert.ok(result);
  assertInc(result!.endsWith("EXPERIMENT-LOG.jsonl"), "path ends with EXPERIMENT-LOG.jsonl");
  cleanup();
});

test("resolveExpectedArtifactPath: verify-hypothesis → EXPERIMENT-NNN-ANALYSIS.md", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("verify-hypothesis", "M001/S01/E003/verify", base);
  assert.ok(result);
  assertInc(result!.endsWith("EXPERIMENT-3-ANALYSIS.md"), "path ends with EXPERIMENT-3-ANALYSIS.md");
  cleanup();
});

test("resolveExpectedArtifactPath: unknown type → null", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("unknown-type", "M001/S01", base);
  assert.strictEqual(result, null);
  cleanup();
});

test("resolveExpectedArtifactPath: run-experiment → EXPERIMENT-LOG.jsonl (existing path unchanged)", () => {
  const { base, cleanup } = createTempGsd();
  const result = resolveExpectedArtifactPath("run-experiment", "M001/S01", base);
  assert.ok(result);
  assertInc(result!.endsWith("EXPERIMENT-LOG.jsonl"), "run-experiment still maps to EXPERIMENT-LOG.jsonl");
  cleanup();
});

// ─── SLICE_DISPATCH_TYPES (grep-based — not exported) ────────────────────────

test("dispatch-guard.ts contains research-hypothesis", () => {
  const content = readFileSync(join(gsdRoot, "dispatch-guard.ts"), "utf-8");
  assert.ok(content.includes('"research-hypothesis"'));
});

test("dispatch-guard.ts contains plan-hypothesis", () => {
  const content = readFileSync(join(gsdRoot, "dispatch-guard.ts"), "utf-8");
  assert.ok(content.includes('"plan-hypothesis"'));
});

test("dispatch-guard.ts contains execute-hypothesis", () => {
  const content = readFileSync(join(gsdRoot, "dispatch-guard.ts"), "utf-8");
  assert.ok(content.includes('"execute-hypothesis"'));
});

test("dispatch-guard.ts contains verify-hypothesis", () => {
  const content = readFileSync(join(gsdRoot, "dispatch-guard.ts"), "utf-8");
  assert.ok(content.includes('"verify-hypothesis"'));
});

// ─── Switch-site coverage (grep-based) ────────────────────────────────────────

test("auto.ts unitVerb has all 4 hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('case "research-hypothesis": return "researching"'));
  assert.ok(content.includes('case "plan-hypothesis": return "planning"'));
  assert.ok(content.includes('case "execute-hypothesis": return "experimenting"'));
  assert.ok(content.includes('case "verify-hypothesis": return "verifying"'));
});

test("auto.ts unitPhaseLabel has all 4 hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('case "research-hypothesis": return "RESEARCH"'));
  assert.ok(content.includes('case "plan-hypothesis": return "PLAN"'));
  assert.ok(content.includes('case "execute-hypothesis": return "EXPERIMENT"'));
  assert.ok(content.includes('case "verify-hypothesis": return "VERIFY"'));
});

test("auto.ts peekNext has all 4 hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('case "research-hypothesis": return "plan experiment 1"'));
  assert.ok(content.includes('case "plan-hypothesis": return "execute experiment"'));
  assert.ok(content.includes('case "execute-hypothesis": return "verify experiment"'));
  assert.ok(content.includes('case "verify-hypothesis": return "next experiment"'));
});

test("auto.ts diagnoseExpectedArtifact has all 4 hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('case "research-hypothesis":'));
  assert.ok(content.includes('case "plan-hypothesis":'));
  assert.ok(content.includes('case "execute-hypothesis":'));
  assert.ok(content.includes('case "verify-hypothesis":'));
});

test("auto.ts ensurePreconditions includes array has all 4 hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  // All 4 must be in the includes array on the ensurePreconditions line
  const match = content.match(/\[.*"research-hypothesis".*"plan-hypothesis".*"execute-hypothesis".*"verify-hypothesis".*\]\.includes\(unitType\)/);
  assert.ok(match, "ensurePreconditions includes array should contain all 4 hypothesis types");
});

test("auto.ts recoverTimedOutUnit handles execute-hypothesis", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('unitType === "execute-hypothesis"'));
});

test("auto.ts recoverTimedOutUnit handles lightweight hypothesis types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('"research-hypothesis", "plan-hypothesis", "verify-hypothesis"'));
});

// ─── CampaignConfig — backward compatibility ────────────────────────────────

test("parseCampaignConfig: hypothesisMode parses correctly when present", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-campaign-"));
  const campaign = {
    name: "Test Campaign",
    targetFiles: ["train.py"],
    evalConfig: { command: "python eval.py", timeout: 60, metrics: [], runs: 1 },
    maxExperiments: 5,
    budgetPerExperiment: 1.0,
    hypothesisMode: true,
  };
  writeFileSync(join(dir, "CAMPAIGN.json"), JSON.stringify(campaign), "utf-8");
  const parsed = parseCampaignConfig(dir);
  assert.ok(parsed);
  assertInc(parsed!.hypothesisMode === true, "hypothesisMode is true");
  assertInc(parsed!.name === "Test Campaign", "name preserved");
  assertInc(parsed!.maxExperiments === 5, "maxExperiments preserved");
  rmSync(dir, { recursive: true });
});

test("parseCampaignConfig: no hypothesisMode → undefined (backward compat)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-campaign-"));
  const campaign = {
    name: "Legacy Campaign",
    targetFiles: ["model.py"],
    evalConfig: { command: "python eval.py", timeout: 60, metrics: [], runs: 1 },
    maxExperiments: 10,
    budgetPerExperiment: 0.50,
  };
  writeFileSync(join(dir, "CAMPAIGN.json"), JSON.stringify(campaign), "utf-8");
  const parsed = parseCampaignConfig(dir);
  assert.ok(parsed);
  assertInc(parsed!.hypothesisMode === undefined, "hypothesisMode is undefined for legacy config");
  assertInc(parsed!.name === "Legacy Campaign", "name preserved");
  rmSync(dir, { recursive: true });
});

test("parseCampaignConfig: missing file → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-campaign-"));
  assert.strictEqual(parseCampaignConfig(dir), null);
  rmSync(dir, { recursive: true });
});

test("parseCampaignConfig: invalid JSON → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-campaign-"));
  writeFileSync(join(dir, "CAMPAIGN.json"), "not json at all", "utf-8");
  assert.strictEqual(parseCampaignConfig(dir), null);
  rmSync(dir, { recursive: true });
});

test("parseCampaignConfig: missing required fields → null", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-campaign-"));
  writeFileSync(join(dir, "CAMPAIGN.json"), JSON.stringify({ name: "Partial" }), "utf-8");
  assert.strictEqual(parseCampaignConfig(dir), null);
  rmSync(dir, { recursive: true });
});

test("types.ts CampaignConfig has hypothesisMode field", () => {
  const content = readFileSync(join(gsdRoot, "types.ts"), "utf-8");
  assert.ok(content.includes("hypothesisMode?: boolean"));
});

// ─── NightShift scaffold ──────────────────────────────────────────────────────

test("nightshift-interview.ts scaffold includes hypothesisMode: true", () => {
  const content = readFileSync(join(gsdRoot, "nightshift-interview.ts"), "utf-8");
  assert.ok(content.includes("hypothesisMode: true"));
});

test("nightshift-interview.ts writes CAMPAIGN.json", () => {
  const content = readFileSync(join(gsdRoot, "nightshift-interview.ts"), "utf-8");
  assert.ok(content.includes('CAMPAIGN.json'));
});

// ─── plan-experiment.md disk write instruction ────────────────────────────────

test("plan-experiment.md contains EXPERIMENT-NNN-PLAN.md write instruction", () => {
  const content = readFileSync(join(gsdRoot, "prompts", "plan-experiment.md"), "utf-8");
  assert.ok(content.includes("EXPERIMENT-{{experimentNumber}}-PLAN.md"));
  assert.ok(content.includes("Persist Your Plan"));
});

// ─── handleAgentEnd coverage ──────────────────────────────────────────────────

test("auto.ts handleAgentEnd has execute-hypothesis handler", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('currentUnit.type === "execute-hypothesis"'));
});

test("auto.ts handleAgentEnd has plan-hypothesis handler", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('currentUnit.type === "plan-hypothesis"'));
});

test("auto.ts handleAgentEnd has verify-hypothesis handler", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('currentUnit.type === "verify-hypothesis"'));
});

test("auto.ts handleAgentEnd has research-hypothesis handler", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('currentUnit.type === "research-hypothesis"'));
});

// ─── Hypothesis state import ──────────────────────────────────────────────────

test("auto.ts imports hypothesis-state module", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assert.ok(content.includes('from "./hypothesis-state.js"'));
});

// ─── Dispatch routing in auto.ts ────────────────────────────────────────────

test("auto.ts hypothesis dispatch routing assigns all 4 unit types", () => {
  const content = readFileSync(join(gsdRoot, "auto.ts"), "utf-8");
  assertInc(content.includes('unitType = "research-hypothesis"'), "assigns research-hypothesis");
  assertInc(content.includes('unitType = "plan-hypothesis"'), "assigns plan-hypothesis");
  assertInc(content.includes('unitType = "execute-hypothesis"'), "assigns execute-hypothesis");
  assertInc(content.includes('unitType = "verify-hypothesis"'), "assigns verify-hypothesis");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nhypothesis-dispatch.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
