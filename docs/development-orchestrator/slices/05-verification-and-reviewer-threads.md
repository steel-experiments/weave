# Verification And Reviewer Threads

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
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

- [x] Verification agent runs bounded checks as a child thread.
- [x] Verification output includes command, exit status, duration, and bounded output.
- [x] Reviewer agent runs read-only as a child thread.
- [x] Reviewer output includes `pass`, `needs-fixes`, or `blocked` verdict and structured findings.
- [x] Slice cannot be marked completed unless required checks and reviewers pass.
- [x] Verification and review results are checkpointed or durably available to the parent.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Add verification schemas.
- [x] Add command runner integration.
- [x] Add reviewer schemas.
- [x] Add initial reviewer role.
- [x] Add slice decision logic.
- [x] Add tests.
- [x] Update docs.

## Completion Notes

- Added `VerificationAgentInputSchema`, `VerificationCommandSpecSchema`, `VerificationResultSchema`, and `VerificationRunner` for bounded deterministic verification.
- Added `createVerificationTool(...)` as `dev.verification.run` with `repo.runTests` and `shell.exec.bounded` capability intent.
- Added `createVerificationAgent(...)`, which requests verification, checkpoints `test-results`, emits `dev.verification.completed`, and returns schema-validated verification output.
- Added `ReviewerAgentInputSchema`, `ReviewResultSchema`, `ReviewerRunner`, `createReviewerTool(...)`, and `createReviewerAgent(...)` for read-only reviewer roles.
- `dev.review.run` declares `repo.read` and `workspace.diff` capability intent and returns `pass`, `needs-fixes`, or `blocked` verdicts with structured findings.
- Reviewer agents checkpoint findings under `review-findings:<reviewer>` and emit `dev.review.completed`.
- Added `evaluateSliceReadinessForCompletion(...)`, which refuses completion unless verification passed and all reviews passed. Failed verification and `needs-fixes` reviews produce `needs-repair`; blocked reviews produce `blocked`.
- Added replay tests for verifier and reviewer child-agent behavior, tool requests, checkpoints, completion events, and slice decision outcomes.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: the parent `weave.sliceRunner` does not yet spawn verifier/reviewer children automatically. This slice ships the child boundaries and decision logic; the orchestration loop can compose them next.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [ ] policy docs if reviewer capability boundaries become reusable
