import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { GitServiceImpl } from "../git-service.ts";
import { getPriorSliceCompletionBlocker } from "../dispatch-guard.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function run(command: string, cwd: string): string {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }).trim();
}

function setupRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "gsd-git-experiment-"));
  run("git init -b main", repo);
  run("git config user.email test@example.com", repo);
  run("git config user.name Test", repo);
  writeFileSync(join(repo, "README.md"), "# Test repo\n");
  run("git add .", repo);
  run("git commit -m 'initial commit'", repo);
  return repo;
}

async function main(): Promise<void> {
  // ─── commitExperiment ─────────────────────────────────────────────────

  console.log("\n=== commitExperiment ===");

  {
    const repo = setupRepo();
    try {
      const svc = new GitServiceImpl(repo);
      // Create a campaign branch and switch to it
      run("git checkout -b gsd/M001/S01", repo);

      // Make a change
      writeFileSync(join(repo, "experiment.txt"), "trial 1\n");

      const hash = svc.commitExperiment("E001", "try approach A");

      // Verify commit message format
      const log = run("git log -1 --format=%s", repo);
      assertEq(log, "experiment(E001): try approach A", "commit message matches experiment format");

      // Verify hash is returned and valid
      assert(typeof hash === "string" && hash.length >= 7, "returns a valid commit hash");

      // Verify the hash matches HEAD
      const head = run("git rev-parse HEAD", repo);
      assertEq(hash, head, "returned hash matches HEAD");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test: commitExperiment throws when nothing to commit
  {
    const repo = setupRepo();
    try {
      const svc = new GitServiceImpl(repo);
      run("git checkout -b gsd/M001/S01", repo);

      let threw = false;
      try {
        svc.commitExperiment("E001", "empty experiment");
      } catch (e) {
        threw = true;
        const msg = e instanceof Error ? e.message : String(e);
        assert(msg.includes("no changes to commit"), "error message mentions no changes");
      }
      assert(threw, "commitExperiment throws when nothing to commit");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // ─── revertExperiment ─────────────────────────────────────────────────

  console.log("\n=== revertExperiment ===");

  {
    const repo = setupRepo();
    try {
      const svc = new GitServiceImpl(repo);
      run("git checkout -b gsd/M001/S01", repo);

      // Make and commit an experiment
      writeFileSync(join(repo, "experiment.txt"), "trial 1\n");
      const hash = svc.commitExperiment("E001", "try approach A");

      // Revert it
      svc.revertExperiment("E001", hash, "didn't improve metrics");

      // Verify revert commit message format
      const log = run("git log -1 --format=%s", repo);
      assertEq(log, "revert(E001): discard — didn't improve metrics", "revert message matches expected format");

      // Verify the working tree is clean
      const status = run("git status --short", repo);
      assertEq(status, "", "working tree is clean after revert");

      // Verify the experiment file is gone (reverted to pre-experiment state)
      const fileExists = run("git ls-files experiment.txt", repo);
      assertEq(fileExists, "", "experiment file is removed after revert");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test: revertExperiment is idempotent
  {
    const repo = setupRepo();
    try {
      const svc = new GitServiceImpl(repo);
      run("git checkout -b gsd/M001/S01", repo);

      // Make and commit an experiment
      writeFileSync(join(repo, "experiment.txt"), "trial 1\n");
      const hash = svc.commitExperiment("E001", "try approach A");

      // Revert it once
      svc.revertExperiment("E001", hash, "first revert");

      // Revert it again — should not throw
      let threw = false;
      try {
        svc.revertExperiment("E001", hash, "duplicate revert");
      } catch {
        threw = true;
      }
      assert(!threw, "revertExperiment is idempotent — second call does not throw");

      // Verify only 3 commits: initial, experiment, first revert (no duplicate revert commit)
      const commitCount = run("git rev-list --count HEAD", repo);
      assertEq(commitCount, "3", "no duplicate revert commit created");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // Test: commit → revert → working tree matches pre-experiment state
  {
    const repo = setupRepo();
    try {
      const svc = new GitServiceImpl(repo);
      run("git checkout -b gsd/M001/S01", repo);

      // Record pre-experiment tree hash
      const preTree = run("git rev-parse HEAD^{tree}", repo);

      // Experiment: add a file and modify README
      writeFileSync(join(repo, "new-file.ts"), "export const x = 1;\n");
      writeFileSync(join(repo, "README.md"), "# Modified\n");
      const hash = svc.commitExperiment("E002", "try approach B");

      // Revert
      svc.revertExperiment("E002", hash, "no improvement");

      // Compare tree hashes — should match pre-experiment
      const postTree = run("git rev-parse HEAD^{tree}", repo);
      assertEq(postTree, preTree, "tree hash matches pre-experiment state after revert");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // ─── dispatch guard allows run-experiment ─────────────────────────────

  console.log("\n=== dispatch guard ===");

  {
    const repo = mkdtempSync(join(tmpdir(), "gsd-dispatch-experiment-"));
    try {
      mkdirSync(join(repo, ".gsd", "milestones", "M001"), { recursive: true });

      writeFileSync(join(repo, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), [
        "# M001: Test",
        "",
        "## Slices",
        "- [x] **S01: Done** `risk:low` `depends:[]`",
        "- [ ] **S02: Active** `risk:low` `depends:[S01]`",
        "",
      ].join("\n"));

      run("git init -b main", repo);
      run("git config user.email test@example.com", repo);
      run("git config user.name Test", repo);
      run("git add .", repo);
      run("git commit -m init", repo);

      // run-experiment for S02 (S01 complete) — should be allowed
      const result1 = getPriorSliceCompletionBlocker(repo, "main", "run-experiment", "M001/S02");
      assertEq(result1, null, "run-experiment allowed when prior slices are complete");

      // run-experiment for S02 when S01 is incomplete — should be blocked
      writeFileSync(join(repo, ".gsd", "milestones", "M001", "M001-ROADMAP.md"), [
        "# M001: Test",
        "",
        "## Slices",
        "- [ ] **S01: Pending** `risk:low` `depends:[]`",
        "- [ ] **S02: Active** `risk:low` `depends:[S01]`",
        "",
      ].join("\n"));
      run("git add .", repo);
      run("git commit -m update", repo);

      const result2 = getPriorSliceCompletionBlocker(repo, "main", "run-experiment", "M001/S02");
      assert(result2 !== null, "run-experiment blocked when prior slice is incomplete");
      assert(
        result2 !== null && result2.includes("M001/S01"),
        "blocker message references the incomplete prior slice",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
