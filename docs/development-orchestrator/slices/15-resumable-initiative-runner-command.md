# Resumable Initiative Runner Command

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Add one dogfood command that takes a PRD/SOW, produces a proposed plan, waits for approval, then resumes and executes approved slices sequentially through the existing orchestrator loop.

## Non-goals

- Do not run unapproved plans.
- Do not execute slices in parallel.
- Do not make OpenCode the control plane.
- Do not auto-push or auto-merge.
- Do not build the dashboard.
- Do not resume auth slices `52` through `56` as part of this slice.

## User Outcome

As a maintainer, I can run a single command for a PRD-backed initiative and let Weave handle planning, approval pause, sequential slice execution, verification, review, bounded repair, and stop gates.

## Architecture Impact

- Adds a productized entrypoint over the shipped development orchestrator pieces.
- Connects PRD compilation, plan approval, workspace allocation, slice execution, verification, review, repair, and initiative terminal state.
- Makes resume behavior explicit so the command can be rerun after a human gate is resolved.
- Preserves existing child-thread and tool-worker responsibilities.
- Emits enough status output that a maintainer knows whether to inspect a gate, wait, or review a final handoff.

## Proposed Command

Initial command name can change during implementation:

```txt
npm run initiative:run -- --from docs/prds/example.md
```

Expected behavior:

- creates or resumes an initiative thread
- records the PRD/SOW as an `InitiativeSpec`
- compiles a proposed `InitiativePlan`
- opens a slice-plan approval gate
- stops until the gate is approved
- after approval, runs slices one at a time
- stops on blocked/failed human gates
- produces final handoff state when all slices complete

## Implementation Plan

1. Add a command wrapper around initiative creation/resume.
2. Load PRD/SOW markdown into `InitiativeSpec` input.
3. Invoke the PRD-to-slices compiler if no proposed plan exists.
4. Open or reuse the plan approval gate.
5. On approved plan, invoke existing initiative sequencing for each slice.
6. Persist/resume current initiative and slice execution state from thread events/checkpoints.
7. Print concise operator status and next command suggestions.
8. Add dogfood docs for the full loop.

## Test Plan

- Unit test command input parsing.
- Unit test resume behavior when a proposed plan already exists.
- Unit test command stops before executing unapproved slices.
- Integration test approved two-slice fixture runs sequentially with fake implementer/verifier/reviewer.
- Failure-path test blocked slice stops initiative execution and reports the gate.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] `initiative:run` or equivalent command exists.
- [x] The command can create a PRD-backed initiative.
- [x] The command creates/reuses a plan approval gate and stops before approval.
- [x] After approval, the command executes approved slices sequentially.
- [x] The command resumes safely after process restart or gate resolution.
- [x] Blocked slices stop the initiative with actionable output.
- [x] Tests cover planning pause, approved execution, and blocked stop behavior.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.
- [x] `git diff --check` passes.

## Progress

- [x] Add command wrapper.
- [x] Add PRD loading.
- [x] Wire compiler and approval gate.
- [x] Wire approved sequential execution.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `npm run initiative:run -- --from <prd.md>` backed by `src/scripts/initiative-run.ts`.
- Added `src/development-initiative-runner.ts` with option parsing, PRD markdown title extraction, slug generation, and `DevelopmentInitiativeInput` construction.
- The command starts an idempotent `weave.maintainer` session with `initiativeSpec`, `createMarkdownInitiativePlanCompiler(...)`, workspace allocation, OpenCode implementation/repair runners, deterministic verification, reviewer agents, and local PR draft handoff.
- The command starts local runner/tool daemons, waits until a human gate or terminal root state, prints initiative status, and prints the next operator command.
- Rerunning with the same generated or explicit `--idempotency-key` resumes after gate resolution because the same root thread is reused.
- Added `src/tests/development-initiative-runner.test.ts` for option parsing and PRD-to-initiative input construction.
- Existing orchestrator contract tests cover planning pause, approved sequential execution, and blocked stop behavior through the maintainer/slice-runner state machine.
- Commands run: `npm exec -- tsx src/tests/development-initiative-runner.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: the command is intentionally local/Postgres-backed and uses the same real OpenCode CLI boundary as other dogfood paths. It does not push, merge, or create a remote PR.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `README.md`
- [x] dogfood runbook docs
