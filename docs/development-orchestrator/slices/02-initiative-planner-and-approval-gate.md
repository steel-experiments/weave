# Initiative Planner And Approval Gate

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Add an initiative planner agent that reads repo context, produces a slice plan, emits proposed-slice events, and pauses for human approval before implementation begins.

## Non-goals

- Do not write code for planned slices.
- Do not create or mutate branches.
- Do not call OpenCode.
- Do not auto-approve plans.

## User Outcome

As a maintainer, I can hand Weave an initiative and get a durable, reviewable slice plan before any implementation work starts.

## Architecture Impact

- Adds `weave.maintainer` or equivalent planner agent.
- Exercises repo-read tooling, durable checkpoints, typed `dev.slice.proposed` events, and a human approval gate.
- Uses child threads only if context gathering is split into bounded research tasks; the first version can stay single-threaded.
- No new persistence primitive should be required.

## Implementation Plan

1. Register an initiative planner agent with the contracts from slice 1.
2. Read bounded repo context from configured files such as `AGENTS.md`, `docs/`, `package.json`, and selected source roots.
3. Checkpoint `initiative-context` so model planning has a stable basis for replay.
4. Produce an ordered `slice-plan` with title, objective, acceptance criteria, risk notes, allowed files when known, and required reviewers.
5. Emit one `dev.slice.proposed` event per slice.
6. Open an `approve-slice-plan` gate with the proposed plan.
7. Checkpoint `approved-slice-plan` only after the gate is approved.

## Test Plan

- Unit test planner output schema validation.
- Replay test that approved slice plan is reused rather than regenerated.
- Gate test that implementation does not start before approval.
- Failure test for invalid planner output.
- Fixture test using a small initiative and two slice markdown files.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] `weave.maintainer` can accept an initiative input.
- [ ] Planner reads only configured repo context.
- [ ] Planner emits proposed-slice events.
- [ ] Planner opens a human approval gate before work starts.
- [ ] Approved slice plan is checkpointed durably.
- [ ] Replay does not regenerate a different approved plan.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Add planner agent.
- [ ] Add repo context read path.
- [ ] Add proposed-slice events.
- [ ] Add approval gate.
- [ ] Add replay tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] relevant examples or app docs if the planner is exposed as a runnable example
