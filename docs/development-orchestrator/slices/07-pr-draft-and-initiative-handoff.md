# PR Draft And Initiative Handoff

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Produce a durable PR draft body and initiative handoff once all approved slices have passed verification and review.

## Non-goals

- Do not merge PRs.
- Do not auto-address external reviewer comments in the first version.
- Do not require GitHub API integration if a local PR draft artifact is enough for the MVP.

## User Outcome

As a maintainer, I can review a concise initiative summary with shipped slices, changed behavior, commands run, known limitations, and follow-ups before deciding whether to open or merge a PR.

## Architecture Impact

- Adds `weave.prAgent` or equivalent final child thread.
- Aggregates slice summaries, verification results, review verdicts, repair attempts, and docs updates.
- Adds optional GitHub PR create/update capability behind policy.
- Adds final human gate before merge.

## PR Draft Contents

The generated PR draft should include:

- initiative title
- base branch and working branch
- shipped slices
- changed behavior
- files or modules changed
- docs updated
- tests and typecheck commands run
- reviewer verdicts
- repair attempts performed
- known limitations
- follow-up suggestions
- human approval checklist

## Implementation Plan

1. Add PR draft input and output schemas.
2. Aggregate completed slice summaries from the initiative thread.
3. Generate a markdown PR body.
4. Store the PR draft as an artifact or checkpoint.
5. Optionally create or update a GitHub PR when `github.pr.create` is granted.
6. Checkpoint `pr-url` when a PR is opened.
7. Emit `dev.pr.opened`, `dev.pr.updated`, or `dev.pr.ready_for_review` events.
8. Add a human gate before merge or before marking the initiative fully accepted.

## Test Plan

- Unit test PR draft generation from fixture slice results.
- Unit test known limitations and failed slices are represented clearly.
- Policy test GitHub PR creation is skipped or denied without capability.
- Integration test completed initiative produces a PR draft artifact.
- Gate test merge remains blocked behind human approval.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Completed initiatives produce a markdown PR draft summary.
- [ ] PR draft includes shipped slices, checks, review verdicts, limitations, and follow-ups.
- [ ] PR draft is durably available after replay.
- [ ] GitHub PR creation is capability-gated.
- [ ] Merge is impossible without human approval.
- [ ] `dev.pr.ready_for_review` or equivalent event is emitted.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Add PR draft schemas.
- [ ] Add summary aggregation.
- [ ] Add PR draft artifact/checkpoint.
- [ ] Add optional GitHub PR create path.
- [ ] Add final human gate.
- [ ] Add tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] GitHub integration docs if PR creation is implemented
- [ ] auth gateway slice plan if this orchestrator becomes the execution path for auth work
