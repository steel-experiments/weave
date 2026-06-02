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
| `tool` | Current primary API |
| `agent` with `run(ctx, input)` | Current primary API |
| `agent` with `planner` | Compatibility escape hatch |
| `weave` | Current app registry API |
| `integration` | Current integration API |
| `ctx.tool` | First durable effect |
| `ctx.emit` | Current replay-safe event helper |
| `event` | Current typed event contract/factory helper |
| `ctx.id` | Current deterministic ID helper |
| `ctx.uuid` | Compatibility alias for `ctx.id` |
| `ctx.gate` | Current approval effect |
| `ctx.checkpoint` | Current local durable effect |
| `ctx.spawn` | Current child-thread effect |
| `ctx.join` | Current child-thread wait effect |
| `ctx.children` | Current child listing helper |
| `approvalPolicy` | Current authoring helper |
| subthread lineage fields | Current storage/read model |
| capabilities | Planned |
| package subpaths | Current runtime boundary |

## Authoring Primitives

- `tool`: declares a typed side-effect contract with input, output, progress, credentials, and `run`.
- `agent`: declares an agent using the new `run(ctx, input)` authoring model or the lower-level planner model.
- `weave`: composes agents, tools, integrations, and runtime dependencies into an application registry.
- `integration`: declares external route and event handling adapters.

The older `defineTool`, `defineAgent`, `defineWeaveApp`, and `defineIntegration` names remain exported for compatibility. New examples should prefer the shorter authoring names.

Capabilities and richer projections are planned public primitives. They are not part of the first V1 authoring slice unless explicitly documented below.

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
import { createWeaveRuntime, ThreadService } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
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
    title: z.string(),
    body: z.string(),
    labels: z.array(z.string()),
  }),
  summarize(output) {
    return output.title;
  },
  async run(ctx) {
    const github = ctx.credentials.value("github.read");
    return inspectIssueWithGitHub(github, ctx.input);
  },
});
```

Tool outputs are domain-shaped. Weave stores the raw output as canonical replay data in `tool.completed.payload.output`. `summary` is optional display metadata produced by `tool.summarize(output)`.

Legacy tools may still return the old `ToolCompletionOutput` envelope with `summary`, `requiresManualApproval`, and optional `data`. For those legacy outputs only, Weave falls back to `output.summary` as display metadata. `requiresManualApproval` is legacy compatibility, not the future approval model.

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
      issue,
    });
    return tests;
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

A pending durable effect should not cause the runner to poll. The runner wakes when a relevant event is appended, such as `tool.completed` or `gate.resolved`. In V1, `tool.failed` is terminal for the thread and does not wake the runner.

After a run-first agent appends terminal response or output events, later runner passes are idempotent and should append no duplicate terminal events.

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
- the run-first adapter treats replayed `ToolFailedError` as no new plan because the thread is already failed

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
- `ctx.checkpoint`
- `ctx.gate`
- later `ctx.spawn`

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
const findingId = ctx.id("finding");
await ctx.emit("finding", {
  type: "agent.finding.produced",
  payload: { findingId, summary },
});
```

Use `ctx.checkpoint` for nondeterministic values that must be persisted:

```ts
const findingId = await ctx.checkpoint("finding-id", () => crypto.randomUUID());
```

## ctx.checkpoint Semantics

`ctx.checkpoint(key, compute)` stores a local durable value in the thread and returns it on replay.

```ts
const normalized = await ctx.checkpoint("normalized-input", () => {
  return normalizeInput(input);
});

const findingId = await ctx.checkpoint("finding-id", () => {
  return crypto.randomUUID();
});
```

Missing:

- run `compute`
- append `checkpoint.completed`
- return the computed value

Completed:

- return the stored checkpoint value
- do not rerun `compute`

Mismatch:

- throw `ReplayMismatchError` if the same key was already used for another durable effect kind

If `compute` throws, Weave throws the error and appends no checkpoint event.

Use checkpoints for:

- expensive pure work
- normalized inputs
- generated IDs
- timestamps
- nondeterministic values that must stay stable across replay
- compact model-prep objects

Checkpoint values are stored in thread events, so keep them small and JSON-shaped. Large outputs should become artifacts later.

## ctx.gate Semantics

`ctx.gate(key, request)` creates a first-class approval gate and returns the recorded resolution after a human or external system resolves it.

```ts
const approval = await ctx.gate("approve-rebuild", {
  reason: "risky-remediation",
  proposedAction: "Drain and rebuild nats-prod-1 in production.",
});

if (approval.resolution === "approved") {
  await ctx.tool("rebuild-node", rebuildNode, input);
}
```

Missing:

- append `gate.created`
- set thread projection to blocked
- suspend the runner pass

Pending:

- append nothing
- suspend the runner pass

Resolved:

- return `gate.resolved.payload`
- let agent logic branch on `approved` or `denied`

Mismatch:

- throw `ReplayMismatchError` if the same key was already used for another durable effect kind
- throw `ReplayMismatchError` if the gate payload changes on replay

`gateId` is deterministic from `threadId + scopeKey + stepKey`. The public code identity is still the stable step key. External resolvers use `ThreadService.resolveGate(threadId, gateId, resolution, comment)`.

Approval policy remains explicit agent logic. Approval intent should not be encoded inside tool output.

## Approval Policy Helpers

`approvalPolicy(...)` is a lightweight authoring helper for reusable approval decisions. It is not a runtime enforcement boundary yet.

```ts
const productionRemediation = approvalPolicy({
  name: "production-remediation",
  requiresApproval(input) {
    return input.environment === "production" && input.risk === "high";
  },
  gate(input) {
    return {
      reason: "risky-remediation",
      proposedAction: `Approve ${input.action} in ${input.environment}.`,
    };
  },
});

const gate = productionRemediation.evaluate(action);
if (gate) {
  const approval = await ctx.gate("approve-action", gate);
  if (approval.resolution === "denied") {
    return;
  }
}
```

Policy helpers are useful for naming and reusing approval rules across agents. The agent still calls `ctx.gate`; future runtime policy enforcement may add stronger guarantees.

## Event Factories And Replay Helpers

`ctx.emit` records replay-safe domain facts. Prefer defining reusable event contracts with `event({ type, payload })`, then emit event instances created by those factories.

### ctx.emit

`ctx.emit` records a replay-safe domain fact in the current thread.

```ts
await ctx.emit(
  "final-response",
  responseProduced({
    message,
  }),
);
```

Semantics:

- requires a stable key
- accepts typed `event({...})` factory instances, typed `event(type, payload)` values, or compatible `{ type, payload }` objects
- durable identity is `threadId + scopeKey + stepKey`
- if the same key, type, and canonical payload were already emitted, it is a no-op
- if the same key is reused with a different type or payload, Weave throws `ReplayMismatchError`
- it records domain facts; it does not make external side effects safe

Good:

```ts
const findingProduced = event({
  type: "agent.finding.produced",
  payload: z.object({
    findingId: z.string().uuid(),
    severity: z.enum(["info", "warning", "critical"]),
    summary: z.string().min(1),
    evidence: z.array(z.object({
      source: z.string().min(1),
      summary: z.string().min(1),
    })),
  }),
});

await ctx.emit(
  "finding:auth-docs",
  findingProduced({
    findingId: ctx.id("finding:auth-docs"),
    severity: "warning",
    summary,
    evidence,
  }),
);
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

### event

`event({ type, payload, ...metadata })` defines a reusable typed event factory. The factory validates payloads with the supplied schema before returning an event input for `ctx.emit`.

```ts
const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
  description: "Final response shown to the user.",
});

await ctx.emit("final-response", responseProduced({ message }));
```

The older `event(type, payload, metadata?)` form still creates a typed event input for `ctx.emit` and remains supported for compatibility.

`event(type, payload, metadata?)` creates a typed event input for `ctx.emit`.

```ts
const finding = event("agent.finding.produced", {
  findingId,
  severity: "warning",
  summary,
  evidence,
});
```

Event helpers do not append anything by themselves. They are typed builders for `ctx.emit` inputs.

### ctx.id

`ctx.id(key)` returns a deterministic UUID-like identifier derived from the current thread, scope, and key.

```ts
const findingId = ctx.id("finding:auth-docs");
```

Semantics:

- deterministic within `threadId + scopeKey + key`
- stable across replay
- useful for event payload IDs
- not random
- not suitable for cryptographic or security-sensitive purposes
- `ctx.uuid(key)` is retained as a compatibility alias

Good:

```ts
const findingId = ctx.id("finding:0");
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
const nonce = ctx.id("oauth-nonce");
```

For nonces, secrets, or security tokens, use a tool, credential provider, or future durable random/capability helper with explicit semantics.

## Parallel Durable Effects

In the first V1 implementation, suspending durable effects must be awaited sequentially.

Prefer:

```ts
const issue = await ctx.tool("inspect-issue", inspectIssue, input);
const tests = await ctx.tool("run-tests", runTests, issue.data);
```

Unsupported:

```ts
const [a, b] = await Promise.all([
  ctx.tool("a", toolA, input),
  ctx.tool("b", toolB, input),
]);
```

If an agent starts a second suspending durable effect before the first suspension is reconciled, Weave throws `ParallelDurableEffectError` with code `PARALLEL_DURABLE_EFFECT`.

This guardrail applies when a second suspending durable effect starts before the first suspension is reconciled, including `ctx.tool`, `ctx.gate`, `ctx.spawn`, `ctx.join`, and `ctx.cancelChild`. Future parallel semantics may allow explicitly batched durable effects, but implicit `Promise.all` is not supported yet.

## Subthread Lineage

The storage and projection model can now represent parent-child thread relationships. `ThreadProjection` includes:

```ts
{
  parentThreadId: string | null;
  rootThreadId: string | null;
  parentScopeKey: string | null;
  parentStepKey: string | null;
}
```

Root sessions use their own `threadId` as `rootThreadId`. Child threads preserve the root thread across nested descendants. Runtime callers can start child sessions through `ThreadService.startChildSession`, and run-first agents can create them with `ctx.spawn`.

```ts
await service.startChildSession({
  parentThreadId,
  agentName: "docs.research",
  input: { repo: "acme/docs" },
  parentScopeKey: "agent:parent",
  parentStepKey: "spawn-research",
  idempotencyKey: "spawn-research",
});
```

The child session stores `input` in `session.started.payload.metadata`, which is the current replay input source for `agent.run`. It also stores the target `agentName` in `session.started.payload.agentName`, so the runtime can dispatch child runner passes to the intended child agent. If that agent is not registered in the runtime app, the child runner records `agent.failed` with `AGENT_NOT_FOUND`. The parent thread receives a `child_thread.spawned` event.

Child sessions support deterministic idempotency through `idempotencyKey`. Reusing the same key with the same child agent, input, prompt, parent scope/step, mode, and parent metadata returns the existing child. Reusing the same key with changed child work throws `ReplayMismatchError`.

Agents can create child sessions with `ctx.spawn`:

```ts
const child = await ctx.spawn("research-docs", docsResearchAgent, {
  repo: "acme/docs",
});
```

`ctx.spawn` is durable and requires a stable key. On first execution it starts the child session through `ThreadService.startChildSession`, appends `child_thread.spawned` to the parent, and suspends the parent runner pass. On replay it returns the existing `ThreadRef`. If the child agent, mode, or input hash changes for the same key, Weave throws `ReplayMismatchError`.

`ctx.spawn` does not wait for the child. Detached children keep lineage but do not block parent completion unless the parent explicitly joins them. Use `ctx.join` when the parent needs a child terminal result.

```ts
const child = await ctx.spawn("research-docs", docsResearchAgent, {
  repo: "acme/docs",
});
const result = await ctx.join("wait-research-docs", child);

if (result.status === "failed") {
  return `Research failed: ${result.message}`;
}

return result.output ?? result.outputSummary;
```

`ctx.join` is durable and requires its own stable key. If the parent has a matching `child_thread.completed` event, it returns `{ status: "completed", thread, output, outputSummary }`. If the parent has a matching `child_thread.failed` event, it returns `{ status: "failed", thread, errorCode, message }`, or throws `ChildThreadFailedError` when `throwOnFailure: true` is set. When the `ThreadRef` came from `ctx.spawn` and the child agent declares an output schema, raw joined output is decoded against that schema before it is returned; invalid stored output raises `ReplayMismatchError`.

Run-first agents store raw non-`undefined` return values in `agent.output.completed`. If the agent declares an `output` schema, Weave validates the returned value before emitting `agent.response.produced` or `agent.output.completed`. Invalid output raises `AGENT_OUTPUT_INVALID`, which the runner records as `agent.failed`. The raw output is canonical replay data; `agent.response.produced` remains the timeline/display message. Child completion mirroring copies `agent.output.completed.payload.output` into `child_thread.completed.payload.output`, making it available as `AgentRun.output` from `ctx.join`.

When no parent terminal event exists, `ctx.join` asks `ThreadService.mirrorChildTerminalEvent` to mirror a terminal child projection into the parent. If the child is still running, the parent runner pass suspends. Mirrored terminal events wake the parent runner with `child-completed` or `child-failed`. Mirroring is idempotent for a parent scope/step and child thread.

Parents can cancel child work they no longer need with `ctx.cancelChild`:

```ts
const child = await ctx.spawn("research-docs", docsResearchAgent, {
  repo: "acme/docs",
});

await ctx.cancelChild("cancel-research-docs", child, {
  reason: "A newer docs audit superseded this child.",
});
```

`ctx.cancelChild` is durable and requires a stable key. Cancellation records terminal `agent.failed` on the child with `errorCode: "CHILD_CANCELLED"`, mirrors `child_thread.failed` into the parent for the cancellation key, and then replays as a no-op. Repeated cancellation of the same child is idempotent. Cancelling an unrelated child or an already completed child is rejected. A later `ctx.join` on the same child returns a failed result with `CHILD_CANCELLED`. Runtime callers can cancel through `ThreadService.cancelChildThread`.

Parents can list known child threads with `ctx.children()`:

```ts
const children = await ctx.children();
```

`ctx.children()` returns attached children by default. Pass `{ includeDetached: true }` to include detached children. Pass `agentName` or `status` to filter returned refs:

```ts
const completedResearch = await ctx.children({
  agentName: "research-docs",
  status: "completed",
});
```

Both filters accept a single value or an array of values. Returned refs include `status` when the child projection is available. Runtime callers can use the same behavior through `ThreadService.listChildren(parentThreadId, options)`.

Parent thread lifecycle events:

- `child_thread.spawned`
- `child_thread.completed`
- `child_thread.failed`

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

Root sessions can target a specific app agent by passing `agentName` to `ThreadService.startSession`:

```ts
await service.startSession({
  prompt: "Review this PR.",
  agentName: "coding.reviewPullRequest",
  metadata: { repo: "acme/app", pullRequestNumber: 42 },
});
```

When `session.started.payload.agentName` is present, the runtime dispatches that thread to the named agent. Threads without `agentName` use the runtime's configured default agent. If the named agent is not registered in the runtime app, the runner records `agent.failed` with `AGENT_NOT_FOUND`.

Root sessions support deterministic idempotency through `idempotencyKey`. Reusing the same key with the same `prompt`, `source`, `agentName`, and `metadata` returns the existing `{ threadId, correlationId }`. Reusing the same key with changed input throws `ReplayMismatchError`.

## Failure Semantics

Failed tools append `tool.failed`, mark the thread failed, and dead-letter the tool-worker inbox item. `tool.failed` is terminal in V1 and does not wake the runner.

If runtime dispatch targets an unknown agent, the runner records `agent.failed` with `AGENT_NOT_FOUND`. If run-first agent input fails the declared `input` schema, the runner records `agent.failed` with `AGENT_INPUT_INVALID`. If an agent planner or `agent.run` throws another non-tool exception, the runner appends `agent.failed`, marks the thread failed, and completes the runner pass. `agent.failed.payload.errorCode` uses the `WeaveError.code` when available, otherwise `AGENT_FAILED`.

Package subpaths separate authoring from runtime binding:

- `weave`: authoring primitives, app registry, event schemas, summaries, timelines, and shared types.
- `weave/runtime`: runtime orchestration, daemons, runners, workers, thread service, credentials, and observability helpers.
- `weave/postgres`: Postgres engine, pool, migrations, artifact store, and observability store.
- `weave/server`: HTTP API server helpers and server-facing types.
- `weave/testing`: mock agent and mock tool worker utilities.

The root export remains backward-compatible for now, but examples should use subpaths for runtime, storage, and server concerns.

## Migration Notes

For a focused migration path from planner-first agents and legacy tool output envelopes, see `docs/migration/api-refactor.md`.

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
    payload: { message: summarizeResult(result) },
  });
  return result;
}
```

Migrate one durable operation at a time. Do not try to rewrite the entire planner into `run` in one step.

## Current Limitations

- `ctx.tool`, `ctx.gate`, `ctx.checkpoint`, `ctx.spawn`, `ctx.join`, `ctx.children`, and `ctx.cancelChild` are implemented.
- `ctx.emit` is implemented and supports typed event factories plus raw compatibility input.
- `ctx.id` is the preferred deterministic ID helper; `ctx.uuid` remains a compatibility alias.
- Legacy tool outputs using `ToolCompletionOutput` are still supported for compatibility, but new tools should return domain-shaped outputs.
- capabilities are planned but not implemented in V1 authoring.
- Package subpaths are available, but root exports still include runtime internals for compatibility.
- `agent.run` is replay-based. Weave suspends the thread, not the JavaScript continuation.
- External side effects must not happen directly inside `agent.run`.
- Parallel durable effects are explicitly unsupported and throw `PARALLEL_DURABLE_EFFECT` when detected.

## Planned Next Primitives

- capability contracts and richer policy enforcement for centralized governance and scoped grants.
- Effect-backed internals behind the same Promise-first public API.
