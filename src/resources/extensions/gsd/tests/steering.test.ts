/**
 * Contract tests for GSD Steering Module.
 * Covers: readSteeringDirective, writeSteeringDirective, clearSteeringDirective,
 * writeSteeringFocus, clearSteeringFocus, getSteeringPromptOverride,
 * checkSteeringDirective facade (refocus, skip_phase, stop), graceful degradation.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readSteeringDirective,
  writeSteeringDirective,
  clearSteeringDirective,
  writeSteeringFocus,
  clearSteeringFocus,
  getSteeringPromptOverride,
  checkSteeringDirective,
  STEERING_FILE,
  STEERING_FOCUS_FILE,
} from '../steering.ts';

import type { SteeringDirective, CampaignConfig } from '../types.ts';
import { writeAgendaState, createInitialAgendaState, readAgendaState, parseAgenda } from '../agenda.ts';
import type { AgendaConfig } from '../types.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function captureStderr(fn: () => void): string[] {
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  fn();
  console.error = origErr;
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════════
// Test fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeDirective(type: 'refocus' | 'skip_phase' | 'stop', message = 'test message'): SteeringDirective {
  return {
    type,
    message,
    timestamp: new Date().toISOString(),
  };
}

function makeAgendaConfig(): AgendaConfig {
  return parseAgenda({
    researchQuestion: 'What learning rate works best?',
    totalExperiments: 10,
    phases: [
      { name: 'exploration', dimension: 'lr', experimentsPerPhase: 5, goal: 'Find LR range' },
      { name: 'refinement', dimension: 'schedule', experimentsPerPhase: 5, goal: 'Optimize' },
    ],
  }) as AgendaConfig;
}

function makeCampaignConfig(withAgenda: boolean): CampaignConfig {
  const base: CampaignConfig = {
    name: 'test-campaign',
    targetFiles: ['src/model.py'],
    evalConfig: { command: 'echo ok', timeout: 30, metrics: [], runs: 1 },
    maxExperiments: 10,
    budgetPerExperiment: 0.5,
  };
  if (withAgenda) {
    base.agenda = makeAgendaConfig();
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {

  // ─── Write/Read roundtrip ─────────────────────────────────────────────

  console.log('\n=== writeSteeringDirective / readSteeringDirective: roundtrip ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const directive = makeDirective('refocus', 'Focus on optimizer');
      writeSteeringDirective(dir, directive);
      const read = readSteeringDirective(dir);

      assert(read !== null, 'roundtrip returns non-null');
      assertEq(read!.type, 'refocus', 'type preserved');
      assertEq(read!.message, 'Focus on optimizer', 'message preserved');
      assert(typeof read!.timestamp === 'string', 'timestamp is string');
    } finally {
      cleanup(dir);
    }
  }

  // ─── readSteeringDirective: missing file ──────────────────────────────

  console.log('\n=== readSteeringDirective: missing file returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const result = readSteeringDirective(dir);
      assertEq(result, null, 'missing file returns null');
    } finally {
      cleanup(dir);
    }
  }

  // ─── readSteeringDirective: empty file ────────────────────────────────

  console.log('\n=== readSteeringDirective: empty file returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeFileSync(join(dir, STEERING_FILE), '');
      const result = readSteeringDirective(dir);
      assertEq(result, null, 'empty file returns null');
    } finally {
      cleanup(dir);
    }
  }

  // ─── readSteeringDirective: corrupt JSON ──────────────────────────────

  console.log('\n=== readSteeringDirective: corrupt JSON returns null with stderr warning ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeFileSync(join(dir, STEERING_FILE), 'not valid json{{{');
      const stderrLines = captureStderr(() => {
        const result = readSteeringDirective(dir);
        assertEq(result, null, 'corrupt JSON returns null');
      });
      assert(stderrLines.some(l => l.includes('[steering]')), 'stderr warning emitted on corrupt JSON');
    } finally {
      cleanup(dir);
    }
  }

  // ─── readSteeringDirective: invalid shape ─────────────────────────────

  console.log('\n=== readSteeringDirective: invalid shape returns null ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      // Missing type
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({ message: 'hi', timestamp: 'now' }));
      const stderrLines1 = captureStderr(() => {
        assertEq(readSteeringDirective(dir), null, 'missing type returns null');
      });
      assert(stderrLines1.some(l => l.includes('[steering]')), 'stderr on missing type');

      // Missing message
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({ type: 'refocus', timestamp: 'now' }));
      captureStderr(() => {
        assertEq(readSteeringDirective(dir), null, 'missing message returns null');
      });

      // Missing timestamp
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({ type: 'refocus', message: 'hi' }));
      captureStderr(() => {
        assertEq(readSteeringDirective(dir), null, 'missing timestamp returns null');
      });

      // Wrong type value
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({ type: 'invalid_type', message: 'hi', timestamp: 'now' }));
      captureStderr(() => {
        assertEq(readSteeringDirective(dir), null, 'wrong type value returns null');
      });

      // type is number, not string
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({ type: 42, message: 'hi', timestamp: 'now' }));
      captureStderr(() => {
        assertEq(readSteeringDirective(dir), null, 'type as number returns null');
      });
    } finally {
      cleanup(dir);
    }
  }

  // ─── writeSteeringDirective: atomic write ─────────────────────────────

  console.log('\n=== writeSteeringDirective: creates file atomically (temp file removed) ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const directive = makeDirective('stop');
      writeSteeringDirective(dir, directive);

      assert(existsSync(join(dir, STEERING_FILE)), 'target file exists after write');
      assert(!existsSync(join(dir, STEERING_FILE + '.tmp')), 'temp file removed after rename');

      // Verify content is valid JSON
      const content = readFileSync(join(dir, STEERING_FILE), 'utf-8');
      const parsed = JSON.parse(content);
      assertEq(parsed.type, 'stop', 'written content has correct type');
    } finally {
      cleanup(dir);
    }
  }

  // ─── clearSteeringDirective ───────────────────────────────────────────

  console.log('\n=== clearSteeringDirective: removes file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('refocus'));
      assert(existsSync(join(dir, STEERING_FILE)), 'file exists before clear');
      clearSteeringDirective(dir);
      assert(!existsSync(join(dir, STEERING_FILE)), 'file removed after clear');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== clearSteeringDirective: no-op on missing file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      // Should not throw
      clearSteeringDirective(dir);
      assert(true, 'no-op on missing file does not throw');
    } finally {
      cleanup(dir);
    }
  }

  // ─── writeSteeringFocus / getSteeringPromptOverride roundtrip ─────────

  console.log('\n=== writeSteeringFocus / getSteeringPromptOverride: roundtrip ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringFocus(dir, 'Focus on learning rate tuning');
      const override = getSteeringPromptOverride(dir);

      assert(override.includes('Steering Override'), 'contains steering override header');
      assert(override.includes('Focus on learning rate tuning'), 'contains the message');
    } finally {
      cleanup(dir);
    }
  }

  // ─── getSteeringPromptOverride: empty string when no file ─────────────

  console.log('\n=== getSteeringPromptOverride: returns empty string when no file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const result = getSteeringPromptOverride(dir);
      assertEq(result, '', 'no file returns empty string');
    } finally {
      cleanup(dir);
    }
  }

  // ─── clearSteeringFocus ───────────────────────────────────────────────

  console.log('\n=== clearSteeringFocus: removes file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringFocus(dir, 'some focus');
      assert(existsSync(join(dir, STEERING_FOCUS_FILE)), 'focus file exists before clear');
      clearSteeringFocus(dir);
      assert(!existsSync(join(dir, STEERING_FOCUS_FILE)), 'focus file removed after clear');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== clearSteeringFocus: no-op on missing file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      clearSteeringFocus(dir);
      assert(true, 'no-op on missing focus file does not throw');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: no directive ─────────────────────────────

  console.log('\n=== checkSteeringDirective: returns null when no directive ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const result = checkSteeringDirective(dir, null);
      assertEq(result, null, 'no directive returns null');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: type='stop' ──────────────────────────────

  console.log('\n=== checkSteeringDirective: stop returns notify with stop=true and clears file ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('stop', 'User requested stop'));
      const result = checkSteeringDirective(dir, null);

      assert(result !== null, 'stop returns non-null');
      assert(result!.stop === true, 'stop flag is true');
      assert(result!.notify.includes('stopped'), 'notify mentions stopped');
      assert(!existsSync(join(dir, STEERING_FILE)), 'STEERING.json cleared after stop');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: type='refocus' ──────────────────────────

  console.log('\n=== checkSteeringDirective: refocus writes STEERING-FOCUS.md, clears STEERING.json ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('refocus', 'Try smaller batch sizes'));
      const result = checkSteeringDirective(dir, null);

      assert(result !== null, 'refocus returns non-null');
      assert(result!.stop === undefined || result!.stop === false, 'refocus does not set stop');
      assert(result!.notify.includes('refocused'), 'notify mentions refocused');
      assert(result!.notify.includes('Try smaller batch sizes'), 'notify includes message');
      assert(!existsSync(join(dir, STEERING_FILE)), 'STEERING.json cleared after refocus');
      assert(existsSync(join(dir, STEERING_FOCUS_FILE)), 'STEERING-FOCUS.md created');

      const focusContent = readFileSync(join(dir, STEERING_FOCUS_FILE), 'utf-8');
      assert(focusContent.includes('Try smaller batch sizes'), 'focus file contains message');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: type='skip_phase' with agenda ────────────

  console.log('\n=== checkSteeringDirective: skip_phase with agenda advances phase ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const config = makeCampaignConfig(true);
      const agendaState = createInitialAgendaState(config.agenda!);
      writeAgendaState(dir, agendaState);

      // Also write a focus file to verify it gets cleared
      writeSteeringFocus(dir, 'old focus');

      writeSteeringDirective(dir, makeDirective('skip_phase', 'Move to refinement'));
      const result = checkSteeringDirective(dir, config);

      assert(result !== null, 'skip_phase returns non-null');
      assert(result!.stop === undefined || result!.stop === false, 'skip_phase does not set stop');
      assert(result!.notify.includes('refinement'), 'notify mentions new phase');
      assert(!existsSync(join(dir, STEERING_FILE)), 'STEERING.json cleared');
      assert(!existsSync(join(dir, STEERING_FOCUS_FILE)), 'STEERING-FOCUS.md cleared');

      // Verify phase was actually advanced
      const newState = readAgendaState(dir);
      assert(newState !== null, 'agenda state still exists');
      assertEq(newState!.currentPhaseIndex, 1, 'phase index advanced to 1');
      assert(newState!.completedPhases.includes('exploration'), 'exploration marked complete');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: skip_phase without agenda ────────────────

  console.log('\n=== checkSteeringDirective: skip_phase without agenda warns and returns notify ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const config = makeCampaignConfig(false); // no agenda
      writeSteeringDirective(dir, makeDirective('skip_phase', 'try to skip'));

      const stderrLines = captureStderr(() => {
        const result = checkSteeringDirective(dir, config);
        assert(result !== null, 'returns non-null even without agenda');
        assert(result!.notify.includes('ignored'), 'notify says ignored');
        assert(result!.notify.includes('no agenda'), 'notify mentions no agenda');
      });
      assert(stderrLines.some(l => l.includes('[steering]')), 'stderr warning emitted');
      assert(!existsSync(join(dir, STEERING_FILE)), 'STEERING.json still cleared');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: skip_phase with null config ──────────────

  console.log('\n=== checkSteeringDirective: skip_phase with null config degrades gracefully ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('skip_phase', 'null config skip'));

      const stderrLines = captureStderr(() => {
        const result = checkSteeringDirective(dir, null);
        assert(result !== null, 'returns non-null with null config');
        assert(result!.notify.includes('ignored'), 'notify says ignored');
      });
      assert(stderrLines.some(l => l.includes('[steering]')), 'stderr on null config skip_phase');
      assert(!existsSync(join(dir, STEERING_FILE)), 'STEERING.json cleared');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Backward compat: null config handles refocus/stop correctly ──────

  console.log('\n=== Backward compat: refocus with null config works ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('refocus', 'null config refocus'));
      const result = checkSteeringDirective(dir, null);
      assert(result !== null, 'refocus works with null config');
      assert(result!.notify.includes('refocused'), 'notify mentions refocused');
      assert(existsSync(join(dir, STEERING_FOCUS_FILE)), 'focus file created with null config');
    } finally {
      cleanup(dir);
    }
  }

  console.log('\n=== Backward compat: stop with null config works ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringDirective(dir, makeDirective('stop', 'null config stop'));
      const result = checkSteeringDirective(dir, null);
      assert(result !== null, 'stop works with null config');
      assert(result!.stop === true, 'stop flag set with null config');
    } finally {
      cleanup(dir);
    }
  }

  // ─── checkSteeringDirective: skip_phase all phases complete ───────────

  console.log('\n=== checkSteeringDirective: skip_phase when all phases complete ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      const config = makeCampaignConfig(true);
      // Create state with all phases complete
      let agendaState = createInitialAgendaState(config.agenda!);
      const { advancePhase: adv } = await import('../agenda.ts');
      agendaState = adv(agendaState, config.agenda!, { accuracy: 0.8 });
      agendaState = adv(agendaState, config.agenda!, { accuracy: 0.9 });
      writeAgendaState(dir, agendaState);

      writeSteeringDirective(dir, makeDirective('skip_phase', 'skip past end'));
      const stderrLines = captureStderr(() => {
        const result = checkSteeringDirective(dir, config);
        assert(result !== null, 'returns non-null');
        assert(result!.notify.includes('ignored'), 'notify says ignored');
        assert(result!.notify.includes('all phases complete'), 'mentions all phases complete');
      });
      assert(stderrLines.some(l => l.includes('[steering]')), 'stderr on skip past end');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Unknown directive type ───────────────────────────────────────────

  console.log('\n=== Unknown directive type handled gracefully ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      // Write a directive with an unknown type by writing raw JSON
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({
        type: 'refocus', // Use valid type first to pass readSteeringDirective validation
        message: 'test',
        timestamp: new Date().toISOString(),
      }));

      // Test that valid types work — the unknown type test needs a different approach
      // since readSteeringDirective validates the type. The 'default' branch in
      // checkSteeringDirective is a safety net. We verify read validates correctly instead.
      const validResult = readSteeringDirective(dir);
      assert(validResult !== null, 'valid directive reads fine');
      clearSteeringDirective(dir);

      // Verify read rejects unknown types at the read layer
      writeFileSync(join(dir, STEERING_FILE), JSON.stringify({
        type: 'teleport',
        message: 'test',
        timestamp: new Date().toISOString(),
      }));
      const stderrLines = captureStderr(() => {
        const result = readSteeringDirective(dir);
        assertEq(result, null, 'unknown type rejected at read layer');
      });
      assert(stderrLines.some(l => l.includes('[steering]')), 'stderr on unknown type');
    } finally {
      cleanup(dir);
    }
  }

  // ─── Multiple directive types roundtrip ───────────────────────────────

  console.log('\n=== All directive types roundtrip correctly ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      for (const type of ['refocus', 'skip_phase', 'stop'] as const) {
        const directive = makeDirective(type, `${type} test`);
        writeSteeringDirective(dir, directive);
        const read = readSteeringDirective(dir);
        assert(read !== null, `${type} directive reads back non-null`);
        assertEq(read!.type, type, `${type} type preserved`);
        clearSteeringDirective(dir);
      }
    } finally {
      cleanup(dir);
    }
  }

  // ─── getSteeringPromptOverride: format verification ───────────────────

  console.log('\n=== getSteeringPromptOverride: format is markdown with header ===');
  {
    const dir = mkdtempSync(join(tmpdir(), 'gsd-steering-test-'));
    try {
      writeSteeringFocus(dir, 'Concentrate on regularization techniques');
      const override = getSteeringPromptOverride(dir);

      assert(override.startsWith('## Steering Override'), 'starts with H2 header');
      assert(override.includes('Concentrate on regularization techniques'), 'includes message body');
      assert(override.endsWith('\n'), 'ends with newline');
    } finally {
      cleanup(dir);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Results
  // ═══════════════════════════════════════════════════════════════════════

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('All tests passed ✓');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
