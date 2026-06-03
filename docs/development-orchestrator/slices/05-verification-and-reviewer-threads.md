# Verification And Reviewer Threads

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Run deterministic verification and read-only review as child threads after a slice implementation completes.

## Non-goals

- Do not repair failed checks in this slice.
- Do not publish GitHub review comments.
- Do not require all specialized reviewers in the first implementation.

## User Outcome

As a maintainer, I can see whether a slice actually passes tests, typecheck, diff checks, and independent review before it is marked complete.

## Architecture Impact

- Adds a verification agent with bounded shell capability.
- Adds reviewer agent contracts with read-only repo and diff access.
- Adds structured verification and review outputs to the slice runner decision path.
- Emits `dev.verification.completed` and `dev.review.completed` events.

## Reviewer Set

Initial reviewers:

- `architecture-reviewer`
- `docs-reviewer`

Follow-up reviewers:

- `replay-safety-reviewer`
- `compatibility-reviewer`
- `security-reviewer` for auth, credentials, capabilities, tokens, and authorization changes

## Implementation Plan

1. Add verification input and output schemas.
2. Add bounded command execution for `npm test`, `npm run typecheck`, and `git diff --check`.
3. Parse command results into structured verification status, output snippets, and failure summaries.
4. Add reviewer input and output schemas with verdicts and findings.
5. Implement at least one read-only reviewer role against diff, docs, tests, and acceptance criteria.
6. Ensure reviewers cannot write files or run mutating commands.
7. Add slice runner evaluation that marks a slice complete only when verification passes and reviewer verdicts pass.

## Test Plan

- Unit test verification result parsing.
- Unit test reviewer result schema validation.
- Policy test reviewer write attempts are denied.
- Integration test mocked implementation followed by verification and reviewer child threads.
- Failure test failed typecheck prevents slice completion.
- Failure test reviewer `needs-fixes` prevents slice completion.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Verification agent runs bounded checks as a child thread.
- [ ] Verification output includes command, exit status, duration, and bounded output.
- [ ] Reviewer agent runs read-only as a child thread.
- [ ] Reviewer output includes `pass`, `needs-fixes`, or `blocked` verdict and structured findings.
- [ ] Slice cannot be marked completed unless required checks and reviewers pass.
- [ ] Verification and review results are checkpointed or durably available to the parent.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Add verification schemas.
- [ ] Add command runner integration.
- [ ] Add reviewer schemas.
- [ ] Add initial reviewer role.
- [ ] Add slice decision logic.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] policy docs if reviewer capability boundaries become reusable
