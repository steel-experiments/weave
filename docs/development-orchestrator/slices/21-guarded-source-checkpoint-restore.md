# Guarded Source Checkpoint Restore

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-05`
- Owner: `weave-maintainer`

## Goal

Add an auditable, guarded way to restore an initiative worktree to a previously created source checkpoint.

## Non-goals

- Do not silently discard uncommitted work.
- Do not restore production or remote branches.
- Do not rewrite history without explicit operator confirmation.
- Do not make rollback automatic during normal slice execution.

## User Outcome

As a maintainer, I can move an initiative worktree back to a known slice checkpoint when a later slice goes wrong, while preserving an audit trail of the restore action.

## Architecture Impact

- Adds restore request and result event payloads.
- Adds a guarded operator command for restore.
- Checks worktree cleanliness before mutation.
- Records restore decisions and outcomes in durable state.

## Implementation Plan

1. Add restore event/checkpoint payload contracts.
2. Add an operator command that locates a source checkpoint by id or SHA.
3. Refuse restore if the worktree is dirty unless an explicit force option is provided.
4. Require confirmation or a human gate before moving the branch.
5. Move the initiative worktree back to the checkpoint SHA.
6. Emit `dev.source_checkpoint.restored` with before/after commit metadata.

## Test Plan

- Unit test restore input validation and dirty-worktree refusal.
- Integration test restore in a temporary Git worktree.
- Test audit event formatting.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Restore can target a known source checkpoint.
- [ ] Dirty worktrees are protected by default.
- [ ] Restore emits a durable audit event.
- [ ] Restore requires explicit human confirmation.
- [ ] Restore does not affect `main` unless explicitly configured outside this slice.

## Progress

- [ ] Add restore contracts.
- [ ] Add guarded operator command.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] operator runbook docs
