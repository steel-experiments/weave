# Repair Loop And Human Stop Gates

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-03`
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

- [ ] Repair agent receives only failures, findings, slice constraints, and scoped repo context.
- [ ] Repair attempts use deterministic child thread keys.
- [ ] Max repair attempts are enforced.
- [ ] Verification and review rerun after repair.
- [ ] Slice completes only after repaired checks and reviews pass.
- [ ] Human gate opens when repair is exhausted or risk policy requires approval.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Add repair schemas.
- [ ] Add repair attempt checkpoint.
- [ ] Add repair child thread loop.
- [ ] Add high-risk gates.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] policy docs if high-risk development policy becomes reusable
