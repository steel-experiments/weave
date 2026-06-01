# Declarative API

## Purpose

Weave apps are authored as TypeScript registries of agents, tools, and integrations.

The public authoring model should feel like ordinary async TypeScript:

```ts
async run(ctx, input) {
  const result = await ctx.tool("stable-key", tool, input);
  return result;
}
```

The runtime turns durable operations into thread events, worker work, resumable waits, and replay-safe outputs.

## API Status

| Primitive | Status |
| --- | --- |
| `tool` / `defineTool` | Current |
| `agent` / `defineAgent` with `planner` | Current |
| `agent` / `defineAgent` with `run(ctx, input)` | New V1 authoring API |
| `ctx.tool` | First durable effect |
| `ctx.emit` | Provisional replay-safe event helper |
| `ctx.uuid` | Provisional deterministic ID helper |
| `ctx.gate` | Planned |
| `ctx.checkpoint` | Planned |
| `ctx.spawn` / `ctx.join` | Planned |
| policies | Planned |
| capabilities | Planned |
| package subpaths | Planned |

## Authoring Primitives

- `tool` / `defineTool`: declares a typed side-effect contract with input, output, progress, optional gate metadata, credentials, and `run`.
- `agent` / `defineAgent`: declares an agent using the new `run(ctx, input)` authoring model or the lower-level planner model.
- `weave` / `defineWeaveApp`: composes agents, tools, integrations, and runtime dependencies into an application registry.
- `integration` / `defineIntegration`: declares external route and event handling adapters.

Gates, policies, capabilities, typed events, projections, checkpoints, and subthreads are planned public primitives. They are not part of the first V1 authoring slice unless explicitly documented below.

## App Definition

`weave({...})` defines an application registry. It does not start runners, bind storage, create workers, or run agents by itself.

```ts
const app = weave({
  name: "acme-agents",
  agents: [fixBug],
  tools: [inspectIssue, runTests],
});
```

Runtime binding stays explicit:

```ts
const runtime = createWeaveRuntime({
  app,
  agentName: "coding.fixBug",
  engine,
  service,
});
```

This keeps authoring separate from storage, runtime ownership, leases, inboxes, credential providers, workers, and deployment mode.

## Tool Authoring

Tools are durable side-effect contracts. They run in workers, not directly inside `agent.run`.

```ts
const inspectIssue = tool({
  name: "github.issue.inspect",
  description: "Read a GitHub issue.",
  input: z.object({
    owner: z.string(),
    repo: z.string(),
    issueNumber: z.number(),
  }),
  output: z.object({
    summary: z.string(),
    requiresManualApproval: z.literal(false),
    data: z.object({
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()),
    }),
  }),
  async run(ctx) {
    const github = ctx.credentials.value("github.read");
    return inspectIssueWithGitHub(github, ctx.input);
  },
});
```

Current limitation: tool outputs still use the `ToolCompletionOutput` envelope with `summary`, `requiresManualApproval`, and optional `data`. This will be relaxed later so tools can return domain-shaped outputs directly.

## Agent Authoring With run(ctx, input)

New application code should prefer `run(ctx, input)`.

```ts
const fixBug = agent({
  name: "coding.fixBug",
  input: z.object({
    owner: z.string(),
    repo: z.string(),
    issueNumber: z.number(),
  }),
  tools: [inspectIssue, runTests],
  async run(ctx, input) {
    const issue = await ctx.tool("inspect-issue", inspectIssue, input);
    const tests = await ctx.tool("run-tests", runTests, {
      owner: input.owner,
      repo: input.repo,
      issue: issue.data,
    });
    return tests.data;
  },
});
```

`agent.run` is replay-based in V1. The function may re-execute from the beginning on every runner pass. Durable `ctx.*` operations reconcile against the thread.

## Suspension And Replay

When an agent calls `await ctx.tool(...)`, the authoring model looks like ordinary async TypeScript. In V1, Weave does not persist the JavaScript continuation. Instead, when a durable operation cannot return yet, the runner appends or observes the appropriate thread event and exits the current runner pass.

The thread is suspended. The JavaScript stack is not.

When a relevant event arrives, such as `tool.completed`, the runner wakes and re-executes `agent.run` from the beginning. Completed durable effects return their recorded outputs. Pending effects suspend again. Missing effects append new events.

Execution trace:

```txt
Pass 1:
  ctx.tool("inspect-issue") is missing
  -> append tool.requested
  -> suspend runner pass

Worker:
  -> append tool.completed

Pass 2:
  ctx.tool("inspect-issue") is completed
  -> return recorded output
  ctx.tool("run-tests") is missing
  -> append tool.requested
  -> suspend runner pass

Worker:
  -> append tool.completed

Pass 3:
  ctx.tool("inspect-issue") returns recorded output
  ctx.tool("run-tests") returns recorded output
  agent returns
  -> append final agent events
```

A pending durable effect should not cause the runner to poll. The runner wakes when a relevant event is appended, such as `tool.completed`, `tool.failed`, or later `gate.resolved`.

## Durable Step Keys

Every durable operation needs a stable key.

Durable identity is:

```txt
threadId + scopeKey + stepKey
```

The default scope is:

```txt
agent:<agentName>
```

Examples:

```ts
await ctx.tool("inspect-issue", inspectIssue, input);
await ctx.tool("run-tests", runTests, input);
```

For loops, include deterministic data in the key:

```ts
for (const file of files) {
  await ctx.tool(`summarize-file:${file.path}`, summarizeFile, file);
}
```

The effect kind is part of reconciliation. Reusing the same key for a different effect kind, such as changing `ctx.tool("review", ...)` into `ctx.emit("review", ...)`, causes `ReplayMismatchError`.

## ctx.tool Semantics

`ctx.tool(key, tool, input)` is the first durable effect.

Missing:

- append `tool.requested`
- enqueue worker work
- suspend the runner pass

Pending:

- append nothing
- suspend the runner pass

Completed:

- decode `tool.completed.payload.output` with the tool output schema
- return the decoded output

Failed:

- throw `ToolFailedError`

Mismatch:

- throw `ReplayMismatchError`

## Safe Code Inside agent.run

Inside `agent.run`, do not perform external side effects directly. Use durable `ctx.*` operations.

Safe:

- deterministic pure computation
- schema parsing
- deterministic transformations
- `ctx.tool`
- `ctx.emit`
- later `ctx.gate`, `ctx.checkpoint`, and `ctx.spawn`

Unsafe:

- raw `fetch`
- direct external API mutations
- direct LLM or model calls
- shell or process execution
- file writes intended as durable effects
- `Date.now()` or `new Date()` when the value affects durable behavior
- `Math.random()`
- `crypto.randomUUID()` when the value affects durable behavior

Unsafe example:

```ts
const findingId = crypto.randomUUID();
await ctx.emit("finding", {
  type: "agent.finding.produced",
  payload: { findingId, summary },
});
```

Use deterministic IDs for now:

```ts
const findingId = ctx.uuid("finding");
await ctx.emit("finding", {
  type: "agent.finding.produced",
  payload: { findingId, summary },
});
```

Later, use `ctx.checkpoint` for nondeterministic values that must be persisted:

```ts
const findingId = await ctx.checkpoint("finding-id", () => crypto.randomUUID());
```

## Provisional Replay Helpers

`ctx.emit` and `ctx.uuid` are provisional V1 helpers used to keep agents from constructing raw thread events. They may be replaced or supplemented by typed `event()` factories, `ctx.checkpoint`, and durable ID helpers before the public API stabilizes.

### ctx.emit

`ctx.emit` records a replay-safe domain fact in the current thread.

```ts
await ctx.emit("final-response", {
  type: "agent.response.produced",
  payload: {
    message,
  },
});
```

Semantics:

- requires a stable key
- durable identity is `threadId + scopeKey + stepKey`
- if the same key, type, and canonical payload were already emitted, it is a no-op
- if the same key is reused with a different type or payload, Weave throws `ReplayMismatchError`
- it records domain facts; it does not make external side effects safe

Good:

```ts
await ctx.emit("finding:auth-docs", {
  type: "agent.finding.produced",
  payload: {
    findingId: ctx.uuid("finding:auth-docs"),
    severity: "warning",
    summary,
    evidence,
  },
});
```

Bad:

```ts
await sendEmail(rawEmailClient, message);
await ctx.emit("email-sent", {
  type: "email.sent",
  payload: { messageId },
});
```

Correct:

```ts
await ctx.tool("send-email", sendEmail, {
  to,
  subject,
  body,
});
```

`ctx.emit` records facts; it does not make unsafe external side effects safe.

### ctx.uuid

`ctx.uuid(key)` returns a deterministic UUID-like identifier derived from the current thread, scope, and key.

```ts
const findingId = ctx.uuid("finding:auth-docs");
```

Semantics:

- deterministic within `threadId + scopeKey + key`
- stable across replay
- useful for event payload IDs
- not random
- not suitable for cryptographic or security-sensitive purposes
- provisional; may be renamed to `ctx.id` or `ctx.stableId` before public API freeze

Good:

```ts
const findingId = ctx.uuid("finding:0");
await ctx.emit("finding:0", {
  type: "agent.finding.produced",
  payload: {
    findingId,
    severity: "warning",
    summary,
  },
});
```

Bad:

```ts
const nonce = ctx.uuid("oauth-nonce");
```

For nonces, secrets, or security tokens, use a tool, capability, credential provider, or future durable random helper with explicit semantics.

## Parallel Durable Effects

In the first V1 implementation, durable effects should be awaited sequentially.

Prefer:

```ts
const issue = await ctx.tool("inspect-issue", inspectIssue, input);
const tests = await ctx.tool("run-tests", runTests, issue.data);
```

Avoid until parallel semantics are documented:

```ts
const [a, b] = await Promise.all([
  ctx.tool("a", toolA, input),
  ctx.tool("b", toolB, input),
]);
```

## Planner Compatibility

Planner-first agents still work:

```ts
const legacyAgent = agent({
  name: "legacy",
  tools: [someTool],
  planner,
});
```

An agent must provide `run` or `planner`. If both are provided, `run` is used by default in normal runtime binding.

`planner` remains the lower-level runtime escape hatch. New application code should prefer `run(ctx, input)`.

## Runtime Binding

Runtime binding is explicit:

```ts
const runtime = createWeaveRuntime({
  app,
  agentName: "coding.fixBug",
  engine,
  service,
});
```

The runtime owns runners, workers, leases, inbox claiming, credentials, artifacts, and observability wiring.

## Migration Notes

Existing planner agents usually construct events manually.

Before:

```ts
planner.plan(threadId, events) => AgentPlan;
```

After:

```ts
async run(ctx, input) {
  const result = await ctx.tool("stable-key", tool, input);
  await ctx.emit("final-response", {
    type: "agent.response.produced",
    payload: { message: result.summary },
  });
  return result;
}
```

Migrate one durable operation at a time. Do not try to rewrite the entire planner into `run` in one step.

## Current Limitations

- `ctx.tool` is the only first-class durable effect implemented in this slice.
- `ctx.emit` and `ctx.uuid` are provisional replay helpers.
- Tool outputs still use the current `ToolCompletionOutput` envelope.
- `ctx.gate`, `ctx.checkpoint`, `ctx.spawn`, `ctx.join`, policies, capabilities, typed event factories, and projections are planned but not implemented in this slice.
- Package subpaths are not split yet; root exports still include runtime internals.
- `agent.run` is replay-based. Weave suspends the thread, not the JavaScript continuation.
- External side effects must not happen directly inside `agent.run`.
- Parallel durable effects are not documented as supported yet.

## Planned Next Primitives

- `ctx.checkpoint` for expensive pure work, generated IDs, timestamps, and nondeterministic values that must be persisted.
- `ctx.gate` for first-class human approval and external decision points.
- `ctx.spawn` and `ctx.join` for child threads and sub-agent work.
- policies and capabilities for centralized governance and scoped grants.
- typed event factories for safer `ctx.emit` calls.
- Effect-backed internals behind the same Promise-first public API.
