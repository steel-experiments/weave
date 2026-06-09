# OpenCode Implementer Boundary

## Status

- Vertical: `development-orchestrator`
- Status: `Shipped`
- Last updated: `2026-06-04`
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

- Extends the OpenCode adapter work from bounded read-only repo tasks toward workspace-scoped implementation tasks.
- Adds `weave.opencodeImplementer` or equivalent child agent role.
- Requires explicit capability requests for repo reads, branch writes, bounded shell commands, and OpenCode execution.
- Produces structured implementation summaries for later verification and PR summaries.

## Implementation Plan

1. Define implementer input with slice title, objective, acceptance criteria, `WorkspaceRef`, branch, allowed files, constraints, and expected output schema.
2. Define output with files changed, tests added, behavior changed, docs changed, known limitations, and follow-up suggestions.
3. Add policy checks for `repo.read`, `repo.write.branch`, bounded command execution, and denied secret access.
4. Reuse or extend the existing OpenCode adapter boundary where practical.
5. Ensure implementer writes happen only inside the configured workspace and working branch.
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

- [x] OpenCode implementer runs as a child thread for one slice.
- [x] Implementer receives objective, acceptance criteria, `WorkspaceRef`, branch, constraints, and allowed files when present.
- [x] Implementer output is schema-validated.
- [x] Branch write policy is enforced.
- [x] OpenCode cannot access secrets or merge PRs.
- [x] Implementation summary is checkpointed.
- [x] Weave does not treat OpenCode claims as verification results.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Define implementer role schema.
- [x] Add policy integration.
- [x] Wire OpenCode adapter boundary.
- [x] Add lifecycle events.
- [x] Add mocked implementation tests.
- [x] Update docs.

## Completion Notes

- Added `OpenCodeImplementerInputSchema` as a workspace-scoped implementation request containing slice id/title, objective, acceptance criteria, `WorkspaceRef`, working branch, optional allowed files, and constraints.
- Added `OpenCodeImplementerOutputSchema` with `completed` and `blocked` outcomes.
- Added `OpenCodeImplementationRunner`, `createOpenCodeImplementationTool(...)`, and `createOpenCodeImplementerAgent(...)`.
- `dev.opencode.implement` is a normal tool boundary with capability intent for `repo.read`, `repo.write.branch`, `opencode.run`, and `shell.exec.bounded`.
- The implementer agent emits `dev.implementation.started`, requests the OpenCode implementation tool, checkpoints `implementation-summary`, emits `dev.implementation.completed`, and returns a schema-validated summary.
- Branch policy blocks `main` and `WorkspaceRef` branch mismatches before the OpenCode runner can execute.
- Allowed-file scope is enforced against the returned implementation summary; out-of-scope changed files produce a structured `blocked` result instead of a completed implementation.
- The boundary does not request GitHub merge capabilities or credentials, so OpenCode cannot merge PRs or access secrets through this role.
- Added mocked runner replay tests proving lifecycle events, tool request, summary checkpoint, completed output, blocked `main` behavior, and allowed-file scope checks.
- Commands run: `npm exec -- tsx src/tests/development-orchestrator-contracts.test.ts`, `npm test`, `npm run typecheck`, `git diff --check`.
- Known gap: this is still a boundary with a mockable runner. A real OpenCode CLI/session runner and actual patch capture should land after verification/reviewer threads exist.

## Docs To Update On Completion

- [x] this slice document
- [x] `../README.md`
- [x] `../../agent-adapters.md`
- [ ] relevant OpenCode adapter example docs
