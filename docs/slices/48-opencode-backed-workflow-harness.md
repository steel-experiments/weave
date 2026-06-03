# OpenCode Backed Workflow Harness

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-examples`

## Goal

Turn the deterministic claim-checking example into a reusable bounded agent adapter that can run OpenCode-style repo tasks through Weave tools, policies, and child threads.

## Non-goals

- Do not add file writes in the first version.
- Do not allow arbitrary shell mutation.
- Do not add broad network access by default.
- Do not execute generated workflow JavaScript.
- Do not build a universal workflow engine.
- Do not replace the deterministic prompt workflow example until the harness has parity tests.

## User Outcome

As an app author, I can register a bounded repo-aware child agent for one claim-checking task and trust that all repo access flows through Weave tools, policies, durable events, and structured output schemas.

## Scope

- Read-only repo tools first.
- No file writes.
- No arbitrary shell mutation.
- Structured output schema for each bounded child task.
- Policy-gated network and shell access.
- One bounded task per child thread.

## Proposed Shape

```ts
const repoClaimChecker = opencodeRepoTaskAgent({
  name: "workflow.claimChecker",
  input: ClaimCheckInputSchema,
  output: ClaimCheckOutputSchema,
  tools: [repoReadFile, repoSearchText],
  limits: {
    maxToolCalls: 20,
    timeoutMs: 120_000,
  },
});
```

The adapter should still expose a normal Weave `agent(...)` contract. It should not introduce a new public runtime primitive unless the example proves one is necessary.

## Architecture Impact

- Adds an example-level reusable harness module, likely under `examples/prompt-workflow-review/src/opencode-harness.ts` first.
- May later move to a shared package/export only after the API stabilizes.
- Uses existing `ctx.tool`, `ctx.checkpoint`, policies, and child-thread boundaries.
- Keeps tool requests visible as `tool.requested`, `tool.completed`, and `tool.failed` events.
- Preserves structured child output validation through Zod schemas.

## Implementation Plan

1. Extract the deterministic repo evidence catalog behind read-only repo tools.
2. Add safe repo read/search tools with explicit capability declarations.
3. Add a bounded OpenCode-style task adapter that can call only registered tools.
4. Enforce one bounded task per child thread.
5. Add limits for max tool calls and timeout behavior.
6. Require output schema validation before the child completes.
7. Update the prompt workflow example to use the adapter for claim checking.
8. Keep network and shell access policy-gated and off by default.

## Test Plan

- Unit test read-only repo tool input/output schemas.
- Unit test denied write/network/shell capability requests.
- Integration test one child claim-check task through the harness.
- Replay test that an interrupted claim-check child does not duplicate tool requests.
- Output schema test for valid and invalid child task responses.
- Policy test that network/shell access requires approval or denial by default.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] A reusable bounded harness exists for one repo task per child thread.
- [x] Harness uses registered Weave tools only.
- [x] Repo access is read-only by default.
- [x] File writes are not available.
- [x] Arbitrary shell mutation is not available.
- [x] Network and shell access are policy-gated.
- [x] Child outputs are schema-validated.
- [x] Prompt workflow example can use the harness for claim checking.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Design harness boundary.
- [x] Implement read-only repo tools.
- [x] Implement bounded task adapter.
- [x] Wire example claim checker through adapter.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

### Shipped Behavior

- Added `examples/prompt-workflow-review/src/opencode-harness.ts`, an example-local bounded OpenCode-style repo task harness.
- Added `opencodeRepoTaskAgent(...)`, which returns a normal Weave `agent(...)` contract and runs one bounded repo task per child thread.
- Added read-only repo tools: `repo.searchText` and `repo.readFile`.
- Added explicit capability declarations for `repo.read`, `repo.write`, `network.access`, and `shell.exec`.
- Kept only `repo.read` available by default; mutable/network/shell capabilities are denied by the example policy helper.
- Added `maxToolCalls` and `timeoutMs` checks inside the harness boundary.
- Wired `workflow.claimChecker` through the harness instead of the older single-purpose `repo.searchEvidence` tool.
- Kept child output validation through the normal Weave agent `output` schema.

### Implementation Files

- `examples/prompt-workflow-review/src/opencode-harness.ts`
- `examples/prompt-workflow-review/src/workflow.ts`
- `examples/prompt-workflow-review/src/workflow.test.ts`

### Tests And Commands Run

- `npm --workspace weave-prompt-workflow-review run test`
- `npm --workspace weave-prompt-workflow-review run typecheck`
- `npm test`
- `npm run typecheck`
- `git diff --check`
- `npm --workspace weave-prompt-workflow-review run demo`

### Known Gaps

- The harness is still example-local, not a shared `weave` public helper or package export.
- The repo catalog is deterministic test data, not a live OpenCode process.
- Network and shell capabilities are represented and denied/gated by policy, but no network/shell tools ship in this slice.
- File writes remain unavailable.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/agent-adapters.md` not updated because the harness is example-local, not reusable beyond the example
- [x] `docs/declarative-api.md` not updated because no public helpers are exposed
- [x] `examples/prompt-workflow-review` docs or README not added in this slice
