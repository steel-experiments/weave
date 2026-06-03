# Full OpenCode Adapter

## Status

- Vertical: `weave-core`
- Status: `Planned`
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

- [ ] `createOpenCodeAgent(...)` or equivalent adapter exists example-locally.
- [ ] Adapter returns a normal Weave agent contract.
- [ ] Adapter can run one bounded repo task per child thread.
- [ ] Real read-only repo tools replace deterministic catalog lookup for claim checks.
- [ ] OpenCode read/search/list operations are mediated through Weave tools where practical.
- [ ] File writes are unavailable.
- [ ] Arbitrary shell mutation is unavailable.
- [ ] Network is disabled by default or policy-gated.
- [ ] Limits are enforced with structured failures.
- [ ] Output is schema-validated.
- [ ] Replay after interruption does not duplicate mediated tool requests.
- [ ] No generated JavaScript is executed.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Finalize adapter contract.
- [ ] Implement bounded read-only repo tools.
- [ ] Implement OpenCode execution boundary.
- [ ] Implement mediated tool calls.
- [ ] Add sandbox and limit enforcement.
- [ ] Wire prompt workflow claim checker.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/agent-adapters.md` if the adapter boundary is reusable enough to document beyond the example
- [ ] `docs/declarative-api.md` only if public helpers are exposed
- [ ] `examples/prompt-workflow-review` docs or README if added
