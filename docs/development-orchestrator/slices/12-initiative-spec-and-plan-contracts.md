# Initiative Spec And Plan Contracts

## Status

- Vertical: `development-orchestrator`
- Status: `Planned`
- Last updated: `2026-06-04`
- Owner: `weave-maintainer`

## Goal

Define the durable contracts for turning a pasted PRD or statement of work into a reviewable initiative plan that can later be approved and executed by the development orchestrator.

## Non-goals

- Do not implement model-backed PRD compilation in this slice.
- Do not execute generated slices.
- Do not create PRs or branches from a PRD.
- Do not add a dashboard.
- Do not change existing auth slices.

## User Outcome

As a maintainer, I can provide a large PRD or statement of work and know the orchestrator has a stable typed place to store the original request, generated plan, proposed slices, constraints, acceptance criteria, and approval state.

## Architecture Impact

- Adds stable schemas for initiative input and generated planning output.
- Separates user-authored `InitiativeSpec` from orchestrator-authored `InitiativePlan`.
- Adds or documents event/checkpoint names for PRD intake, plan proposal, plan revision, approval, and rejection.
- Preserves thread events and checkpoints as the durable source of truth.
- Keeps generated slice plans as claims until approved by a human gate.

## Contract Shape

The first contract should support:

- title
- summary
- goals
- non-goals
- constraints
- acceptance criteria
- risks
- implementation hints
- affected areas
- proposed ordered slices
- per-slice objective
- per-slice acceptance criteria
- per-slice allowed files or expected touchpoints
- per-slice verification strategy
- plan revision history
- approval state

## Implementation Plan

1. Add `InitiativeSpec` and `InitiativePlan` schemas near the existing development orchestrator contracts.
2. Add slice proposal schemas that are specific enough to drive execution but not coupled to one implementation runner.
3. Add typed event factories or schema entries for initiative spec received, plan proposed, plan revised, plan approved, and plan rejected.
4. Add checkpoint naming for the current initiative spec, proposed plan, approved plan, and latest plan decision.
5. Add contract tests for valid and invalid specs/plans.
6. Update development orchestrator docs with the new planning vocabulary.

## Test Plan

- Unit test valid `InitiativeSpec` parsing.
- Unit test invalid/missing required fields fail with useful errors.
- Unit test `InitiativePlan` parsing with multiple ordered slices.
- Unit test slice proposal constraints and verification strategy parsing.
- Contract test event/checkpoint payload schemas.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] `InitiativeSpec` schema exists and is exported from the development orchestrator boundary.
- [ ] `InitiativePlan` schema exists and includes ordered slice proposals.
- [ ] Plan proposal, revision, approval, and rejection events are documented or typed.
- [ ] Checkpoints for spec, proposed plan, approved plan, and decision state are documented or implemented.
- [ ] Tests cover valid and invalid specs/plans.
- [ ] Existing orchestrator behavior remains unchanged.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `git diff --check` passes.

## Progress

- [ ] Add schemas.
- [ ] Add event/checkpoint vocabulary.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `README.md`
- [ ] event taxonomy docs if new public events are added
