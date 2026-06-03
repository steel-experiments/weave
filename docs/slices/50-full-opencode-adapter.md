# Full OpenCode Adapter

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-03`
- Owner: `weave-examples`

## Goal

Adapt the example-local OpenCode-style harness into a full bounded OpenCode adapter that can run real repository-aware tasks through Weave tools, policies, durable child threads, and structured output schemas.

## User Outcome

As an app author, I can register an OpenCode-backed Weave agent for one bounded repo task and trust that file access, shell/network attempts, output validation, limits, and replay behavior are mediated by Weave rather than hidden inside an opaque process.

## Non-goals

- Do not execute model-generated workflow JavaScript.
- Do not add general dynamic workflow patterns.
- Do not enable file writes in the first full adapter slice.
- Do not allow arbitrary shell mutation.
- Do not allow network access by default.
- Do not promote a public `weave/opencode` subpath until the example-local API stabilizes.

## Adapter Contract

The adapter should return a normal Weave `agent(...)` contract.

Proposed shape:

```ts
const claimChecker = createOpenCodeAgent({
  name: "workflow.claimChecker",
  input: ClaimCheckInputSchema,
  output: ClaimCheckOutputSchema,
  taskPrompt(input) {
    return `Check this claim against the repository: ${input.claim.text}`;
  },
  tools: [repoReadFile, repoSearchText, repoListFiles],
  limits: {
    maxToolCalls: 20,
    timeoutMs: 120_000,
    maxBytesRead: 1_000_000,
    maxOutputBytes: 50_000,
  },
});
```

The first implementation can remain example-local under `examples/prompt-workflow-review/src/opencode-adapter.ts`. Promotion to a shared export is a later decision.

## Scope

### 1. Real Read-Only Repo Tools

Replace deterministic catalog reads with bounded local repository tools:

- `repo.listFiles`
- `repo.readFile`
- `repo.readRange`
- `repo.searchText`
- optional `repo.getDiff` if safe and read-only

Constraints:

- allowed repository root must be explicit
- path traversal denied
- denied globs supported
- max file size enforced
- max total bytes read enforced
- no writes
- no shell mutation

### 2. OpenCode Execution Boundary

Choose the smallest practical execution mode:

- child process controlled by a tool worker
- SDK/library if available
- remote OpenCode session driver if local process mediation is not viable

The adapter must not give OpenCode direct unmediated filesystem or shell access. OpenCode tool calls must be translated into Weave `ctx.tool(...)` requests wherever practical.

If direct tool mediation is not possible, the fallback must be a bounded `opencode.runTask` tool with reduced traceability documented explicitly.

### 3. Tool Mediation

Required behavior:

- OpenCode requests read/search/list work.
- Adapter maps the request to deterministic `ctx.tool(...)` step keys.
- Tool worker performs bounded operation.
- Result returns to the OpenCode loop.
- Every operation appears as normal Weave `tool.requested`, `tool.completed`, or `tool.failed` events.

### 4. Limits And Sandboxing

Enforce:

- max tool calls
- timeout
- max file size
- max total bytes read
- max output bytes
- allowed path roots
- denied path globs
- no writes
- no arbitrary shell mutation
- network disabled by default

Limit failures should become structured agent/tool failures with useful error codes and messages.

### 5. Structured Output

OpenCode must produce schema-validated data supplied by the caller.

If output cannot be parsed or fails the schema:

- do not silently coerce it
- record the normal agent output validation failure path
- preserve raw diagnostic text in bounded diagnostics if safe

### 6. Policy Integration

Capabilities should be explicit and inspectable:

- `repo.read`: allowed by the example default policy
- `repo.write`: denied in this slice
- `shell.exec`: denied or approval-required
- `network.access`: denied or approval-required

The adapter should declare requested capabilities before execution so request policies can inspect them.

### 7. Replay Semantics

OpenCode execution must stay replay-safe:

- task prompt/spec is checkpointed
- generated OpenCode tool call plan state is deterministic or durably checkpointed
- tool step keys are deterministic
- completed tool outputs are reused on replay
- retries do not duplicate tool requests
- changed task specs cause controlled mismatch or rejection

Replay correctness is more important than matching OpenCode's native in-memory loop exactly.

## Architecture Impact

- Extends the prompt workflow example from deterministic repo evidence to real read-only repository tools.
- Adds an OpenCode adapter boundary, initially example-local.
- May add small adapter-specific abstractions, but no core Weave primitive is expected.
- Keeps Weave as the durable control layer for tool calls, policy decisions, child threads, and output validation.

## Implementation Plan

1. Define `createOpenCodeAgent(...)` options and return a normal Weave agent contract.
2. Replace deterministic repo catalog with real bounded read-only repo tools.
3. Add path/root/glob/byte-limit enforcement for repo tools.
4. Add an OpenCode process/session boundary with a mockable interface.
5. Implement mediation from OpenCode read/search requests to Weave `ctx.tool(...)` calls.
6. Add deterministic step-key generation for mediated tool calls.
7. Add structured output parsing and schema validation.
8. Add policy tests for write, shell, and network requests.
9. Wire `workflow.claimChecker` through the full adapter while preserving the current demo behavior.
10. Keep deterministic mocks for CI and add a local opt-in path for real OpenCode execution.

## Test Plan

- Unit test `repo.listFiles`, `repo.readFile`, `repo.readRange`, and `repo.searchText` schemas and bounds.
- Unit test path traversal denial.
- Unit test denied globs.
- Unit test max file size and max total bytes read failures.
- Integration test one OpenCode-backed claim-check child task through mediated Weave tools.
- Replay test interruption after N mediated tool calls does not duplicate requests.
- Policy test file write request is denied.
- Policy test shell/network request is denied or approval-required by default.
- Output schema mismatch fails cleanly.
- Timeout and max tool calls exceeded fail cleanly.
- Existing prompt workflow demo still passes with mocked OpenCode execution.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [x] `createOpenCodeAgent(...)` or equivalent adapter exists example-locally.
- [x] Adapter returns a normal Weave agent contract.
- [x] Adapter can run one bounded repo task per child thread.
- [x] Real read-only repo tools replace deterministic catalog lookup for claim checks.
- [x] OpenCode read/search/list operations are mediated through Weave tools where practical.
- [x] File writes are unavailable.
- [x] Arbitrary shell mutation is unavailable.
- [x] Network is disabled by default or policy-gated.
- [x] Limits are enforced with structured failures.
- [x] Output is schema-validated.
- [x] Replay after interruption does not duplicate mediated tool requests.
- [x] No generated JavaScript is executed.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Finalize adapter contract.
- [x] Implement bounded read-only repo tools.
- [x] Implement OpenCode execution boundary.
- [x] Implement mediated tool calls.
- [x] Add sandbox and limit enforcement.
- [x] Wire prompt workflow claim checker.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added example-local `examples/prompt-workflow-review/src/opencode-adapter.ts`.
- Added `createOpenCodeAgent(...)`, which returns a normal Weave `agent(...)` contract and accepts a mockable `OpenCodeSessionRunner` boundary.
- Replaced the deterministic in-memory repository catalog with real bounded read-only repository tools: `repo.listFiles`, `repo.readFile`, `repo.readRange`, and `repo.searchText`.
- Added explicit repository root resolution, path traversal denial, denied-glob handling, max file size checks, max tool call checks, max total bytes read checks, timeout checks, and max output byte checks.
- Routed adapter read/search/range/list operations through deterministic `ctx.tool(...)` step keys so the normal `tool.requested`, `tool.completed`, policy, and replay paths remain visible to Weave.
- Wired `workflow.claimChecker` through `createOpenCodeAgent(...)` with a deterministic runner for CI and an opt-in real `opencode run --format json` CLI integration test behind the same runner interface.
- Kept file writes, shell execution, and network access unavailable through the adapter and denied by the example policy when requested as capabilities.
- Added compatibility re-export from `opencode-harness.ts` to the new adapter module.
- Added tests for repo tool schemas, real read/list/range/search, path traversal denial, denied globs, max file size failure, structured output parsing, and the mediated workflow trace.
- Verification run:
- `npm --workspace weave-prompt-workflow-review run test`
- `npm --workspace weave-prompt-workflow-review run typecheck`
- `npm test`
- `npm run typecheck`
- `git diff --check`
- `npm --workspace weave-prompt-workflow-review run demo`
- `npm --workspace weave-prompt-workflow-review run test:opencode`

Replay note: mediated calls use deterministic `ctx.tool(...)` keys and therefore reuse recorded tool outputs on replay. The explicit interruption regression remains covered by core replay tests rather than a new example-local runner harness.

Real OpenCode note: `test:opencode` shells out to the local `opencode` binary, gathers repository evidence through Weave-mediated `repo.searchText` and `repo.readRange` tool calls, then asks OpenCode to return schema-validated JSON from that evidence. Normal CI remains deterministic and does not require model credentials.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/agent-adapters.md` if the adapter boundary is reusable enough to document beyond the example
- [ ] `docs/declarative-api.md` only if public helpers are exposed
- [ ] `examples/prompt-workflow-review` docs or README if added
