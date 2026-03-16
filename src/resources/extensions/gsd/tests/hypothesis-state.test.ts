/**
 * Hypothesis State Module — Contract Tests
 *
 * Tests: read/write/advance, atomic writes, corrupt recovery, phase sequencing,
 * initial state shape, result formatting.
 * Created in T01 as skeleton; T02 fills with assertions.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readHypothesisState,
  writeHypothesisState,
  createInitialHypothesisState,
  advanceHypothesisPhase,
  formatResultsForVerify,
} from '../hypothesis-state.js';

import type { ExperimentResult } from '../types.js';

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

// ─── readHypothesisState ──────────────────────────────────────────────────────

test("readHypothesisState returns null on missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  assert.strictEqual(readHypothesisState(dir), null);
  rmSync(dir, { recursive: true });
});

test("readHypothesisState returns null with warning on corrupt JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeFileSync(join(dir, "HYPOTHESIS-STATE.json"), "not json", "utf-8");
  const result = readHypothesisState(dir);
  assert.strictEqual(result, null);
  rmSync(dir, { recursive: true });
});

test("readHypothesisState returns null on invalid shape", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeFileSync(join(dir, "HYPOTHESIS-STATE.json"), JSON.stringify({ version: 1 }), "utf-8");
  const result = readHypothesisState(dir);
  assert.strictEqual(result, null);
  rmSync(dir, { recursive: true });
});

test("readHypothesisState returns null on empty file", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeFileSync(join(dir, "HYPOTHESIS-STATE.json"), "", "utf-8");
  assert.strictEqual(readHypothesisState(dir), null);
  rmSync(dir, { recursive: true });
});

test("readHypothesisState returns null on invalid subPhase value", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeFileSync(join(dir, "HYPOTHESIS-STATE.json"), JSON.stringify({
    version: 1, subPhase: "bogus", experimentNumber: 1, completedPhases: []
  }), "utf-8");
  assert.strictEqual(readHypothesisState(dir), null);
  rmSync(dir, { recursive: true });
});

// ─── writeHypothesisState / round-trip ────────────────────────────────────────

test("writeHypothesisState and readHypothesisState round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  const state = createInitialHypothesisState();
  writeHypothesisState(dir, state);
  const read = readHypothesisState(dir);
  assert.deepStrictEqual(read, state);
  rmSync(dir, { recursive: true });
});

test("atomic write removes tmp file on success", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  const state = createInitialHypothesisState();
  writeHypothesisState(dir, state);
  assert.strictEqual(existsSync(join(dir, "HYPOTHESIS-STATE.json.tmp")), false);
  assert.strictEqual(existsSync(join(dir, "HYPOTHESIS-STATE.json")), true);
  rmSync(dir, { recursive: true });
});

test("writeHypothesisState produces valid JSON with newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, createInitialHypothesisState());
  const raw = readFileSync(join(dir, "HYPOTHESIS-STATE.json"), "utf-8");
  assertInc(raw.endsWith("\n"), "file should end with newline");
  const parsed = JSON.parse(raw);
  assertInc(parsed.version === 1, "JSON version field should be 1");
  rmSync(dir, { recursive: true });
});

// ─── createInitialHypothesisState ─────────────────────────────────────────────

test("createInitialHypothesisState returns correct shape", () => {
  const state = createInitialHypothesisState();
  assert.strictEqual(state.version, 1);
  assert.strictEqual(state.subPhase, "research");
  assert.strictEqual(state.experimentNumber, 1);
  assert.deepStrictEqual(state.completedPhases, []);
});

// ─── advanceHypothesisPhase ───────────────────────────────────────────────────

test("advanceHypothesisPhase: research → plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, createInitialHypothesisState());
  const result = advanceHypothesisPhase(dir, "research");
  assert.ok(result);
  assert.strictEqual(result.subPhase, "plan");
  assert.strictEqual(result.experimentNumber, 1);
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: plan → execute", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, { version: 1, subPhase: "plan", experimentNumber: 1, completedPhases: ["research"] });
  const result = advanceHypothesisPhase(dir, "plan");
  assert.ok(result);
  assert.strictEqual(result.subPhase, "execute");
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: execute → verify", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, { version: 1, subPhase: "execute", experimentNumber: 1, completedPhases: ["research", "plan-E1"] });
  const result = advanceHypothesisPhase(dir, "execute");
  assert.ok(result);
  assert.strictEqual(result.subPhase, "verify");
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: verify → plan (next experiment)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, { version: 1, subPhase: "verify", experimentNumber: 1, completedPhases: ["research", "plan-E1", "execute-E1"] });
  const result = advanceHypothesisPhase(dir, "verify", 5);
  assert.ok(result);
  assert.strictEqual(result.subPhase, "plan");
  assert.strictEqual(result.experimentNumber, 2);
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: verify → done (max experiments reached)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, { version: 1, subPhase: "verify", experimentNumber: 3, completedPhases: [] });
  const result = advanceHypothesisPhase(dir, "verify", 3);
  assert.strictEqual(result, null);
  // State should be persisted with 'done' in completedPhases
  const finalState = readHypothesisState(dir);
  assert.ok(finalState);
  assert.ok(finalState.completedPhases.includes("done"));
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: verify without maxExperiments cycles indefinitely", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, { version: 1, subPhase: "verify", experimentNumber: 10, completedPhases: [] });
  const result = advanceHypothesisPhase(dir, "verify");
  assert.ok(result);
  assert.strictEqual(result.subPhase, "plan");
  assert.strictEqual(result.experimentNumber, 11);
  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: full cycle research→plan→execute→verify→plan(2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, createInitialHypothesisState());

  advanceHypothesisPhase(dir, "research");
  let s = readHypothesisState(dir)!;
  assert.strictEqual(s.subPhase, "plan");

  advanceHypothesisPhase(dir, "plan");
  s = readHypothesisState(dir)!;
  assert.strictEqual(s.subPhase, "execute");

  advanceHypothesisPhase(dir, "execute");
  s = readHypothesisState(dir)!;
  assert.strictEqual(s.subPhase, "verify");

  advanceHypothesisPhase(dir, "verify", 5);
  s = readHypothesisState(dir)!;
  assert.strictEqual(s.subPhase, "plan");
  assert.strictEqual(s.experimentNumber, 2);

  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: completedPhases accumulates correctly", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  writeHypothesisState(dir, createInitialHypothesisState());

  advanceHypothesisPhase(dir, "research");
  advanceHypothesisPhase(dir, "plan");
  advanceHypothesisPhase(dir, "execute");
  advanceHypothesisPhase(dir, "verify", 5);

  const s = readHypothesisState(dir)!;
  assertInc(s.completedPhases.includes("research"), "completedPhases includes research");
  assertInc(s.completedPhases.includes("plan-E1"), "completedPhases includes plan-E1");
  assertInc(s.completedPhases.includes("execute-E1"), "completedPhases includes execute-E1");
  assertInc(s.completedPhases.includes("verify-E1"), "completedPhases includes verify-E1");

  rmSync(dir, { recursive: true });
});

test("advanceHypothesisPhase: from missing state bootstraps to initial", () => {
  const dir = mkdtempSync(join(tmpdir(), "hyp-test-"));
  // No state file exists — advance should bootstrap from initial (research) and advance to plan
  const result = advanceHypothesisPhase(dir, "research");
  assert.ok(result);
  assert.strictEqual(result.subPhase, "plan");
  rmSync(dir, { recursive: true });
});

// ─── formatResultsForVerify ───────────────────────────────────────────────────

test("formatResultsForVerify produces readable markdown", () => {
  const result: ExperimentResult = {
    id: "exp-001",
    description: "Test experiment",
    metrics: { accuracy: 0.85, loss: 0.15 },
    decision: { decision: "keep", reason: "Improved accuracy", comparison: {} },
    duration: 5000,
    cost: 0.50,
    diff: "+added line\n-removed line",
  };
  const md = formatResultsForVerify(result);
  assertInc(md.includes("exp-001"), "contains experiment id");
  assertInc(md.includes("keep"), "contains decision");
  assertInc(md.includes("Improved accuracy"), "contains reason");
  assertInc(md.includes("accuracy"), "contains metric name");
  assertInc(md.includes("0.8500"), "contains formatted metric value");
  assertInc(md.includes("$0.5000"), "contains formatted cost");
  assertInc(md.includes("```diff"), "contains diff fence");
  assertInc(md.includes("Test experiment"), "contains description");
  assertInc(md.includes("5.0s"), "contains formatted duration");
  assertInc(md.includes("### Metrics"), "contains Metrics heading");
});

test("formatResultsForVerify handles simplicity score", () => {
  const result: ExperimentResult = {
    id: "exp-003",
    description: "Simplicity test",
    metrics: { perf: 0.9 },
    decision: { decision: "keep", reason: "Good", comparison: {} },
    duration: 2000,
    cost: 0.25,
    diff: "",
    simplicityScore: { score: 0.85, linesAdded: 5, linesRemoved: 3, filesChanged: 1, explanation: "Minimal changes" },
  };
  const md = formatResultsForVerify(result);
  assertInc(md.includes("Simplicity Score"), "contains Simplicity Score heading");
  assertInc(md.includes("0.85"), "contains simplicity score value");
  assertInc(md.includes("Minimal changes"), "contains simplicity explanation");
});

test("formatResultsForVerify handles empty metrics", () => {
  const result: ExperimentResult = {
    id: "exp-002",
    description: "Empty metrics test",
    metrics: {},
    decision: { decision: "discard", reason: "No improvement", comparison: {} },
    duration: 1000,
    cost: 0.10,
    diff: "",
  };
  const md = formatResultsForVerify(result);
  assertInc(md.includes("exp-002"), "contains id");
  assertInc(md.includes("discard"), "contains discard decision");
  assertInc(md.includes("### Description"), "contains Description heading");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nhypothesis-state.test.ts: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
