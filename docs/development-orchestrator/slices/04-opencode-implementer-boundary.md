# OpenCode Implementer Boundary

## Status

- Vertical: `development-orchestrator`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-maintainer`

## Goal

Add an OpenCode-backed implementer child agent that can make scoped changes for one slice and return a schema-validated implementation summary.

## Non-goals

- Do not let OpenCode control the overall initiative.
- Do not let OpenCode merge PRs.
- Do not grant unrestricted shell, network, secret, or filesystem access.
- Do not trust OpenCode test claims without independent verification.

## User Outcome

As a maintainer, I can delegate one approved slice to OpenCode while Weave keeps the task bounded, inspectable, policy-mediated, and independently verifiable.

## Architecture Impact

- Extends the OpenCode adapter work from bounded read-only repo tasks toward branch-scoped implementation tasks.
- Adds `weave.opencodeImplementer` or equivalent child agent role.
- Requires explicit capability requests for repo reads, branch writes, bounded shell commands, and OpenCode execution.
- Produces structured implementation summaries for later verification and PR summaries.

## Implementation Plan

1. Define implementer input with slice title, objective, acceptance criteria, branch, allowed files, constraints, and expected output schema.
2. Define output with files changed, tests added, behavior changed, docs changed, known limitations, and follow-up suggestions.
3. Add policy checks for `repo.read`, `repo.write.branch`, bounded command execution, and denied secret access.
4. Reuse or extend the existing OpenCode adapter boundary where practical.
5. Ensure implementer writes happen only on the configured working branch.
6. Emit `dev.implementation.started` and `dev.implementation.completed` events.
7. Checkpoint implementation summary for replay and review.

## Test Plan

- Unit test implementer input and output schema validation.
- Policy test write outside `allowedFiles` requires denial or human approval.
- Policy test writes to `main` are denied.
- Integration test a mocked OpenCode implementer changes a fixture file and returns a valid summary.
- Failure test invalid OpenCode output fails clearly.
- Replay test completed implementation summary is reused.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] OpenCode implementer runs as a child thread for one slice.
- [ ] Implementer receives objective, acceptance criteria, branch, constraints, and allowed files when present.
- [ ] Implementer output is schema-validated.
- [ ] Branch write policy is enforced.
- [ ] OpenCode cannot access secrets or merge PRs.
- [ ] Implementation summary is checkpointed.
- [ ] Weave does not treat OpenCode claims as verification results.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Define implementer role schema.
- [ ] Add policy integration.
- [ ] Wire OpenCode adapter boundary.
- [ ] Add lifecycle events.
- [ ] Add mocked implementation tests.
- [ ] Update docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `../README.md`
- [ ] `../../agent-adapters.md`
- [ ] relevant OpenCode adapter example docs
