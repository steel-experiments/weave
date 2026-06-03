# OpenCode Backed Workflow Harness

## Status

- Vertical: `weave-core`
- Status: `Planned`
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

- [ ] A reusable bounded harness exists for one repo task per child thread.
- [ ] Harness uses registered Weave tools only.
- [ ] Repo access is read-only by default.
- [ ] File writes are not available.
- [ ] Arbitrary shell mutation is not available.
- [ ] Network and shell access are policy-gated.
- [ ] Child outputs are schema-validated.
- [ ] Prompt workflow example can use the harness for claim checking.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Design harness boundary.
- [ ] Implement read-only repo tools.
- [ ] Implement bounded task adapter.
- [ ] Wire example claim checker through adapter.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/agent-adapters.md` if the harness becomes reusable beyond the example
- [ ] `docs/declarative-api.md` only if public helpers are exposed
- [ ] `examples/prompt-workflow-review` docs or README if added
