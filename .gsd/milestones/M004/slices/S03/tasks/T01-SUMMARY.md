---
id: T01
parent: S03
milestone: M004
provides:
  - SSHBackend class implementing ComputeBackend.runEval() via native ssh binary
  - SSHBackendConfig variant in ComputeConfig discriminated union
  - resolveBackend() routing for type 'ssh'
  - Fixed RunEvalResult import in compute-backend.ts (was types.js, now eval-runner.js)
key_files:
  - src/resources/extensions/gsd/ssh-backend.ts
  - src/resources/extensions/gsd/types.ts
  - src/resources/extensions/gsd/compute-backend.ts
key_decisions: []
patterns_established:
  - SSH exit code mapping (124=timeout, 255=connection, ETIMEDOUT=safety-net) as explicit branches in mapSSHResult()
  - Remote command assembly as cd → git fetch+reset → env prefix → timeout eval
  - shellQuote() helper for safe embedding of env values in remote command strings
observability_surfaces:
  - RunEvalResult.stderr contains SSH diagnostic output on connection failure
  - Push errors surfaced in stderr field via "Code sync failed:" prefix
  - Exit code mapping is grep-discoverable: `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' ssh-backend.ts`
duration: 15m
verification_result: passed
completed_at: 2026-03-15
blocker_discovered: false
---

# T01: Implement SSHBackend class and wire into factory

**SSHBackend class runs eval commands on remote hosts via native ssh with timeout enforcement, connection reuse, and structured error mapping.**

## What Happened

Created `ssh-backend.ts` with `SSHBackend` implementing `ComputeBackend.runEval()`. The flow: pushExperimentBranch() for code sync → detect current branch → build env prefix (export KEY='VALUE';) → build remote command (cd workDir && git fetch origin && git reset --hard origin/branch && timeout secs command) → spawnSync('ssh', args) with safety-net timeout (+30s) → map result via mapSSHResult().

SSH args include BatchMode=yes, ControlMaster=auto, ControlPath (configurable, defaults to /tmp/gsd-ssh-%r@%h:%p), ControlPersist=60, ConnectTimeout=10, StrictHostKeyChecking=accept-new.

Extended ComputeConfig union in types.ts with `{ type: 'ssh'; host: string; workDir: string; controlPath?: string }`.

Fixed pre-existing import bug in compute-backend.ts: RunEvalResult was imported from `./types.js` but is defined in `./eval-runner.ts`. Changed to `./eval-runner.js`.

Added `case 'ssh'` to resolveBackend() factory, importing and instantiating SSHBackend.

## Verification

- `npx tsx src/resources/extensions/gsd/tests/compute-backend.test.ts` — 45 pass, 0 fail (unchanged)
- Factory routing verified via temp test file: `resolveBackend({ type: 'ssh', host: 'localhost', workDir: '/tmp' })` returns SSHBackend instance (constructor.name === 'SSHBackend', instanceof === true)
- Observability signals confirmed: `grep -n 'exit.*124\|exit.*255\|ETIMEDOUT' ssh-backend.ts` returns 7 matches across comments and code

### Slice-level verification status (T01 is intermediate — partial pass expected):
- ✅ `compute-backend.test.ts` — 45 assertions pass
- ⬜ `ssh-backend.test.ts` — not yet created (T02)
- ✅ `resolveBackend({ type: 'ssh', ... })` returns SSHBackend instance
- ⬜ SSH connection error produces RunEvalResult with error in stderr — implemented but not yet tested via contract tests (T02)

## Diagnostics

- Exit code mapping in `mapSSHResult()`: 124=remote timeout, 255=SSH connection error, ETIMEDOUT=safety-net timeout
- Push failure detection: `syncResult.error && !syncResult.pushed` → early return with "Code sync failed:" prefix in stderr
- Connection reuse: ControlMaster=auto with ControlPersist=60 and configurable ControlPath

## Deviations

- Task plan verification command (`npx tsx -e "import ..."`) fails due to `@gsd/pi-coding-agent` package exports issue in the import chain (ssh-backend → code-sync → git-service → worktree → preferences → @gsd/pi-coding-agent). Used a temp test file with relative imports instead, matching the pattern the existing test suite uses.

## Known Issues

None.

## Files Created/Modified

- `src/resources/extensions/gsd/ssh-backend.ts` — New file: SSHBackend class with runEval(), mapSSHResult(), shellQuote()
- `src/resources/extensions/gsd/types.ts` — Extended ComputeConfig union with SSH variant
- `src/resources/extensions/gsd/compute-backend.ts` — Fixed RunEvalResult import, added SSHBackend import and case 'ssh' in resolveBackend()
