# Repair Loop And Human Stop Gates

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Add a bounded repair loop that fixes only verification failures and reviewer findings, then reruns checks. Stop at a human gate when repair attempts are exhausted or risk policy requires approval.

## Non-goals

- Do not let repair agents expand slice scope.
- Do not continue indefinitely.
- Do not merge or open PRs.
- Do not bypass security, auth, policy, replay, or migration review gates.

## User Outcome

As a maintainer, I can let Weave attempt narrow repairs without losing control of scope, risk, or auditability.

## Architecture Impact

- Adds `weave.opencodeRepair` or equivalent repair child agent.
- Adds deterministic repair attempt keys such as `repair:0`, `repair:1`, and `repair:2`.
- Adds max-attempt policy and human stop gates.
- Exercises durable replay of repeated implement-verify-review cycles.

## Implementation Plan

1. Add repair input with failing tests, reviewer findings, slice constraints, branch, and allowed files.
2. Add repair output with files changed, fixes attempted, findings addressed, and limitations.
3. Track `repair-attempt-count` as a checkpoint.
4. Use deterministic child thread names for each attempt.
5. Rerun verification and required reviews after each repair.
6. Stop and open a human gate when max attempts are reached.
7. Stop and open a human gate immediately for high-risk policy triggers.
8. Emit `dev.repair.started`, `dev.repair.completed`, and `dev.slice.failed` when appropriate.

## Test Plan

- Unit test repair decision logic.
- Unit test max repair attempts.
- Replay test attempt keys remain stable.
- Integration test one failed verification, one repair, and one passing rerun.
- Failure test repair cannot change files outside allowed scope without approval.
- Gate test high-risk files require human decision before continuing.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] Repair agent receives only failures, findings, slice constraints, and scoped repo context.
- [x] Repair attempts use deterministic child thread keys.
- [x] Max repair attempts are enforced.
- [ ] Verification and review rerun after repair.
- [ ] Slice completes only after repaired checks and reviews pass.
- [x] Human gate opens when repair is exhausted or risk policy requires approval.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Add repair schemas.
- [x] Add repair attempt checkpoint.
- [x] Add repair child thread boundary.
- [x] Add high-risk gates.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `RepairAgentInputSchema`, `RepairResultSchema`, `RepairLoopDecisionSchema`, `RepairRunner`, `createRepairTool(...)`, and `createRepairAgent(...)`.
- `dev.opencode.repair` is a workspace-scoped OpenCode tool boundary with `repo.read`, `repo.write.branch`, `opencode.run`, and bounded shell capability intent.
- Repair input carries `WorkspaceRef`, branch, slice constraints, failing commands, reviewer findings, attempt number, and max-attempt policy.
- Added deterministic `repairAttemptKey(...)` values such as `repair:0` and `repair:1`.
- Added `decideRepairLoop(...)`, which either permits a repair attempt or opens a human stop decision when max attempts are exhausted or high-risk findings/files are present.
- Added `repair-stop` as a typed manual gate reason.
- The repair agent checkpoints `repair-attempt-count`, emits `dev.repair.started`, calls `dev.opencode.repair`, emits `dev.repair.completed`, and returns a schema-validated repair result.
- Added replay tests for repair tool requests, lifecycle events, completed output, exhausted-attempt human gate behavior, and repair decision helpers.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: the parent `weave.sliceRunner` still does not automatically rerun verification and reviewers after repair. This slice ships the repair boundary and stop-gate policy; the parent orchestration loop should compose implement, verify, review, repair, rerun, and completion decisions next.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [ ] policy docs if high-risk development policy becomes reusable
