# Initiative-Level Sequencing

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
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

- [x] Approved initiatives execute slices serially.
- [x] No parallel slice execution occurs.
- [x] The next slice starts only after the previous slice completed.
- [x] The initiative stops on the first blocked or failed slice.
- [x] Completed slices are aggregated for PR draft generation.
- [x] The PR draft agent runs after the final slice completes.
- [x] GitHub PR creation is disabled unless explicitly configured.
- [x] Replay does not duplicate slice or PR child threads.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Add initiative execution state schemas.
- [x] Add initiative action schemas.
- [x] Add next-action decision helper.
- [x] Wire serial slice child execution.
- [x] Wire terminal PR draft child execution.
- [x] Add blocked/failed stop behavior.
- [x] Add replay tests.
- [x] Update docs.

## Completion Notes

- Added `InitiativeExecutionPhaseSchema`, `InitiativeExecutionStateSchema`, and `InitiativeActionSchema`.
- Added `createInitialInitiativeExecutionState(...)` and pure `decideNextInitiativeAction(...)`.
- Added `createWeaveMaintainerAgent(...)`, preserving default `weaveMaintainer` planning/approval behavior when no child agents are configured.
- When supplied with a slice runner, the maintainer runs approved slices serially with deterministic keys `slice:<sliceId>` and `wait-slice:<sliceId>`.
- Completed slice outputs are converted into `CompletedDevelopmentSliceSummary` values for PR draft aggregation.
- When supplied with a PR agent, the maintainer runs a local-only PR draft child by default with keys `pr-draft` and `wait-pr-draft`.
- The initiative stops on the first blocked or failed slice and returns a durable blocked output with `blockedSlice` and `blockerReason`.
- Added replay tests for serial two-slice completion, local-only PR draft handoff, first-slice blocked stop behavior, and pure initiative action decisions.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm exec -- tsx src/tests/public-api-exports.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gaps: workspace allocation/lifecycle remains slice 10. Real OpenCode execution remains slice 11. The full auth slice line should still start with a one-slice dry run before unattended execution.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [ ] auth gateway execution notes if the auth slices become runnable through this path
