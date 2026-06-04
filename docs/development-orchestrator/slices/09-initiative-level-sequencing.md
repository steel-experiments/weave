# Initiative-Level Sequencing

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Wire the approved initiative plan into serial slice execution, stopping deterministically on blocked or failed slices and spawning the PR draft agent only after all slices complete.

The initiative loop should run:

```txt
approved initiative plan
  -> run slice 1
  -> if completed, run slice 2
  -> stop on blocked or failed slice
  -> after final slice, spawn PR draft agent
```

For the auth gateway initiative, this later becomes:

```txt
approved auth plan
  -> run 51-auth-gateway-thread-start
  -> run 52-auth-context-runtime-policy
  -> run 53-authenticated-thread-actions
  -> run 54-authenticated-integration-ingress
  -> run 55-auth-decision-audit-trail
  -> run 56-auth-provider-adapter-boundary
  -> PR draft
```

## Non-goals

- Do not execute slices in parallel.
- Do not add the real OpenCode runner.
- Do not allocate or clean up workspaces beyond accepting the workspace strategy from slice 60.
- Do not auto-create or merge GitHub PRs unless explicitly configured.
- Do not run the full auth gateway initiative unattended.

## User Outcome

As a maintainer, I can approve a slice plan once and have Weave run each slice in order, stopping at the first unsafe or failed point with a durable summary.

## Architecture Impact

- Extends `weave.maintainer` beyond plan approval into initiative coordination.
- Adds initiative execution state and progress events or summaries.
- Uses `weave.sliceRunner` from slice 58 as the only way to execute individual slices.
- Uses `weave.prAgent` from slice 7 as the terminal handoff boundary.
- Keeps serial execution as the MVP to simplify audit and repair behavior.

## Proposed Initiative State Shape

```ts
type InitiativeExecutionPhase =
  | "planned"
  | "approved"
  | "slice-running"
  | "slice-completed"
  | "blocked"
  | "completed"
  | "pr-draft-ready";

interface InitiativeExecutionState {
  initiative: string;
  baseBranch: string;
  workingBranch: string;
  currentSliceIndex: number;
  phase: InitiativeExecutionPhase;
  completedSlices: CompletedDevelopmentSliceSummary[];
  blockedSlice?: string;
  blockerReason?: string;
  prDraft?: PrDraftResult;
}
```

## Deterministic Child Keys

- slice child: `slice:<sliceId>`
- slice wait: `wait-slice:<sliceId>`
- PR child: `pr-draft`
- PR wait: `wait-pr-draft`

## Implementation Plan

1. Add initiative execution state schemas.
2. Add a pure `decideNextInitiativeAction(state)` helper.
3. Reuse approved plan checkpoints from `weave.maintainer`.
4. Spawn one `weave.sliceRunner` child at a time.
5. Join each slice child before starting the next slice.
6. Convert completed slice outputs into `CompletedDevelopmentSliceSummary` values for the PR agent.
7. Stop immediately on a blocked or failed slice.
8. Emit durable initiative progress events or checkpointed summaries after each slice.
9. Spawn `weave.prAgent` after the final slice completes.
10. Support local-only PR draft mode by default.
11. Keep GitHub PR creation disabled unless explicitly configured.

## Test Plan

- Unit test initiative next-action decisions.
- Replay test two slices run serially and complete.
- Replay test second slice does not start before first slice completes.
- Replay test blocked first slice prevents second slice from starting.
- Replay test failed slice produces durable initiative blocker summary.
- Replay test completed final slice spawns PR draft agent.
- Replay test PR draft is local-only by default.
- Replay test no duplicate slice children after replay.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Approved initiatives execute slices serially.
- [ ] No parallel slice execution occurs.
- [ ] The next slice starts only after the previous slice completed.
- [ ] The initiative stops on the first blocked or failed slice.
- [ ] Completed slices are aggregated for PR draft generation.
- [ ] The PR draft agent runs after the final slice completes.
- [ ] GitHub PR creation is disabled unless explicitly configured.
- [ ] Replay does not duplicate slice or PR child threads.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Add initiative execution state schemas.
- [ ] Add initiative action schemas.
- [ ] Add next-action decision helper.
- [ ] Wire serial slice child execution.
- [ ] Wire terminal PR draft child execution.
- [ ] Add blocked/failed stop behavior.
- [ ] Add replay tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] auth gateway execution notes if the auth slices become runnable through this path
