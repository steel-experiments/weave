# Finalization Git Side Effects

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
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
- Records merge or PR side-effect results in checkpoints.
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

- [x] Default finalization remains local handoff only.
- [x] `local-merge` only runs after final approval.
- [x] Successful local merge is checkpointed/audited.
- [x] Merge conflicts stop for human intervention.
- [x] Finalization refuses to run if required source checkpoints are missing.

## Progress

- [x] Add finalization mode contracts.
- [x] Add local merge runner.
- [x] Wire final approval to local merge mode.
- [x] Add tests.

## Completion Notes

- Added `FinalizationConfigSchema`, `FinalizationResultSchema`, and `finalization-result` checkpoints.
- Kept finalization mode `none` as the default local handoff behavior.
- Added `local-merge` finalization behind the existing `pr-review-approval` gate.
- Added a local Git merge runner/tool that records base branch, working branch, before SHA, after SHA, strategy, and summary.
- Added `finalization-stop` gates for missing source checkpoints, missing repo root, dirty repositories, merge conflicts, and unexpected Git failures.
- Confirmed merge conflicts are reported for human intervention and are not auto-resolved by the runner.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] local development runbook docs
