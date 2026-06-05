# Per-Slice Git Commit Checkpoints

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Teach Weave Maintainer to create a real Git commit after each slice passes implementation, verification, and review.

## Non-goals

- Do not add rollback or restore commands.
- Do not merge the working branch into the base branch.
- Do not push commits to a remote.
- Do not allow source checkpoint creation before verification and review pass.

## User Outcome

As a maintainer, each completed slice leaves behind a commit SHA I can inspect, diff, cherry-pick, or use as the base for the next slice.

## Architecture Impact

- Adds a source checkpoint runner/helper that operates in the allocated workspace.
- Extends slice execution so source checkpoint creation happens before marking the slice completed.
- Stores the resulting commit metadata in a `source-checkpoint` workflow checkpoint.
- Turns commit failures into a human gate instead of silently completing the slice.

## Implementation Plan

1. Add a Git source checkpoint helper that reads `HEAD`, changed files, and staged/untracked status.
2. Stage the implementation diff for the slice, including untracked files.
3. Commit with a deterministic message derived from slice title/id.
4. Store `baseSha`, `checkpointSha`, changed files, verification results, reviewer results, and workspace ref.
5. Ensure the next slice runs from the updated working branch commit.
6. Stop at a human gate if there is no diff or commit creation fails unexpectedly.

## Test Plan

- Unit test commit message construction.
- Integration test a temporary Git workspace receives a checkpoint commit.
- Slice runner test verifies completed slices include a source checkpoint before completion.
- Failure test verifies commit errors become a human stop gate.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] A passing slice creates one Git commit on the working branch.
- [ ] The `source-checkpoint` checkpoint stores the created commit SHA.
- [ ] Untracked implementation files are included in the checkpoint commit.
- [ ] The next slice starts from the previous slice checkpoint commit.
- [ ] Commit failures are durable and require human intervention.

## Progress

- [ ] Add Git source checkpoint helper.
- [ ] Wire source checkpoint creation into slice runner completion.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] local development runbook docs
