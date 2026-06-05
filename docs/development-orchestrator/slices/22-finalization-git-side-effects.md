# Finalization Git Side Effects

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Add explicit finalization modes so Weave Maintainer can perform approved final Git side effects after all slices complete.

## Non-goals

- Do not make merge or remote PR creation the default behavior.
- Do not bypass the final `pr-review-approval` gate.
- Do not merge when verification, review, or source checkpoints are missing.
- Do not auto-resolve merge conflicts.

## User Outcome

As a maintainer, I can choose a safe finalization mode for an initiative: local handoff only, local merge after approval, or remote PR creation after approval.

## Architecture Impact

- Extends PR/finalization options with explicit modes.
- Adds local merge execution after `pr-review-approval` when enabled.
- Records merge or PR side-effect results in checkpoints/events.
- Converts conflicts or side-effect failures into human gates.

## Implementation Plan

1. Add finalization mode config: `none`, `local-merge`, and later `remote-pr`.
2. Keep `none` as the default for dogfood safety.
3. After `pr-review-approval`, verify source checkpoints exist for all completed slices.
4. For `local-merge`, merge the working branch into the base branch locally.
5. Record merge result metadata, including base branch, working branch, before SHA, after SHA, and strategy.
6. Stop at a human gate on conflicts or unexpected Git errors.

## Test Plan

- Unit test finalization mode parsing and defaults.
- Integration test local merge in a temporary Git repo.
- Failure test merge conflict becomes a human gate.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Default finalization remains local handoff only.
- [ ] `local-merge` only runs after final approval.
- [ ] Successful local merge is checkpointed/audited.
- [ ] Merge conflicts stop for human intervention.
- [ ] Finalization refuses to run if required source checkpoints are missing.

## Progress

- [ ] Add finalization mode contracts.
- [ ] Add local merge runner.
- [ ] Wire final approval to local merge mode.
- [ ] Add tests.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] local development runbook docs
