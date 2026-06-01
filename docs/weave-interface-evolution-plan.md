# Weave Interface Evolution Plan

## Status

- Status: Planned
- Last updated: 2026-06-01
- Owner: weave-core

## Goal

Evolve Weave from a runtime-oriented module seam into a developer-facing agentic toolkit while preserving the existing durable kernel.

The public authoring surface should feel like ordinary TypeScript. The runtime internals may later become Effect-powered, but Effect must not be required to author Weave agents in V1.

## Accepted Direction

Keep the existing runtime kernel:

- `ThreadEngine`
- `ThreadLeaseStore`
- `InboxStore`
- `ThreadRunner`
- `ToolWorker`
- `ContractToolWorker`
- `PostgresThreadEngine`
- `ThreadArtifactStore`
- `ObservabilitySink`
- `ObservabilityReader`
- `ThreadService`
- `createApiServer`
- `createWeaveRuntime`

Add a higher-level authoring seam above it:

```ts
const fixBug = agent({
  name: "coding.fixBug",
  tools: [inspectIssue, runTests],
  async run(ctx, input) {
    const issue = await ctx.tool("inspect-issue", inspectIssue, input);
    const testResult = await ctx.tool("run-tests", runTests, issue);
    return testResult;
  },
});
```

The authored function is replay-based in the first implementation. It is re-executed from the beginning on each runner pass. Completed durable effects return from thread events. Missing or pending durable effects suspend the current runner pass and let the runner exit. V1 supports durable thread suspension, but not persisted JavaScript continuation suspension.

## Architecture Layers

```txt
public authoring API
  weave, agent, tool, gate, policy, capability, event

durable effect layer
  ctx.tool, ctx.gate, ctx.decide, ctx.capability, ctx.waitFor, ctx.sleep

existing runtime kernel
  ThreadEngine, ThreadRunner, InboxStore, ToolWorker, artifacts, observability

future Effect internals
  services, layers, typed errors, resource safety, workflow/cluster adapters
```

## Open Decisions Resolved

### Durable Suspension Model

Weave V1 implements logical suspension through replay-based durable effects. It does not keep or persist JavaScript continuations.

Agent authors still write ordinary async code:

```ts
async run(ctx, input) {
  const issue = await ctx.tool("inspect-issue", inspectIssue, input);
  const approval = await ctx.gate("approve-plan", approvePlan, { issue });
  const pr = await ctx.tool("create-pr", createPullRequest, { issue, approval });
  return pr;
}
```

When a durable effect cannot yet return, the runner appends the appropriate event, updates the thread projection when needed, and exits the current runner pass. No process should stay pinned and no Promise should wait in memory for a human, worker, timer, or external event.

On wake, `agent.run(ctx, input)` re-executes from the beginning. Each durable effect reconciles against the thread using `threadId + scopeKey + stepKey`. Completed effects return recorded outputs. Pending effects suspend. Missing effects append new requested events.

This gives the public semantic model of suspension without requiring continuation capture in V1. Later Effect workflow support may change the runtime substrate without changing the public authoring API.

The runner should not poll waiting threads. Waiting threads should wake from relevant events:

- tool wait wakes on `tool.completed` or `tool.failed`
- gate wait wakes on `gate.resolved`
- timer wait wakes on `timer.fired`
- event wait wakes on a matching appended event

Programming rule: external side effects inside `agent.run` must go through durable `ctx.*` operations. Pure computation is safe during replay. Raw side effects such as `fetch`, direct file writes, process execution, and external API mutations are unsafe because they run again on every replay.

### Runtime Binding

`weave({...})` should not return a runtime-capable app in the first slice.

For now, `weave({...})` returns an app definition or registry object. Runtime binding stays explicit:

```ts
const app = weave({
  name: "acme",
  agents: [fixBug],
  tools: [inspectIssue, runTests],
});

const runtime = createWeaveRuntime({
  app,
  agentName: "coding.fixBug",
  engine,
  service,
});
```

This keeps authoring separate from engine, lease, inbox, artifact, credential, owner, and distributed execution choices.

### Durable Identity

Durable effect identity is scoped by:

```txt
threadId + scopeKey + stepKey
```

The first default scope is:

```ts
scopeKey = `agent:${agentName}`;
```

`threadId + stepKey` is too broad because a thread may eventually contain multiple agents, helper scopes, spawned agents, integrations, and policy-generated gates. `threadId + agentName + stepKey` is better but does not account for nested scopes or reusable helper functions.

Add optional event fields:

```ts
export interface ThreadEventInput<Payload = unknown> {
  threadId: string;
  type: string;
  actor: Actor;
  payload: Payload;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  scopeKey?: string;
  stepKey?: string;
  visibility?: EventVisibility;
}
```

Public rule: a step key must be stable and unique within the current agent run scope.

If a previous event exists for the same durable identity but a different effect kind, the runtime should throw `ReplayMismatchError`.

### Tool Completion Payload

`tool.completed` should store raw output as canonical replay data plus optional denormalized summary metadata.

Target shape:

```ts
export interface ToolCompletedPayload<Output = unknown> {
  toolCallId: string;
  toolName: string;
  scopeKey: string;
  stepKey: string;
  output: Output;
  summary?: string;
  artifactIds?: readonly string[];
}
```

The canonical output is used for replay. The summary is display metadata for timelines, dashboards, notifications, compact thread summaries, and audit views.

Existing `ToolCompletionOutput` remains a compatibility shape during migration.

### Gate Identity

`stepKey` is the public code identity. `gateId` remains the runtime and human-resolution identity.

Public authoring:

```ts
await ctx.gate("approve-plan", approvePlan, { issueTitle, plan });
```

Runtime payload:

```ts
export interface GateCreatedPayload<Input = unknown> {
  gateId: string;
  gateName: string;
  scopeKey: string;
  stepKey: string;
  input: Input;
  status: "pending";
}
```

`ThreadService.resolveGate(threadId, gateId, resolution, comment)` remains the external resolution path. Repeated execution of the same `ctx.gate()` must not create duplicate gates.

### Package Boundaries

Package subpaths should come after the new authoring surface is proven in examples.

Order:

1. Add new root aliases and types.
2. Implement replay-based `run(ctx, input)` plus `ctx.tool`.
3. Migrate one simple example.
4. Migrate one gate-heavy example.
5. Split exports into `weave`, `weave/runtime`, `weave/postgres`, `weave/server`, `weave/testing`, `weave/inspect`, and later `weave/effect`.

## First Slice Scope

Implement only the replay-based async authoring adapter and `ctx.tool`.

Included:

- `MaybePromise`
- `AgentContract.run?`
- `AgentContract.planner?`
- async-compatible `AgentPlanner.plan`
- `AgentContext` with only `ctx.tool`
- optional `scopeKey` and `stepKey` on tool-related events
- run-to-planner adapter
- one migrated example

Not included:

- `ctx.gate`
- `ctx.decide`
- `ctx.capability`
- policies
- arbitrary tool outputs
- package subpaths
- Effect internals
- persisted JavaScript continuation suspension

## Replay-Based `ctx.tool` Semantics

Given:

```ts
async run(ctx, input) {
  const issue = await ctx.tool("inspect-issue", inspectIssue, input);
  const patch = await ctx.tool("edit-files", editFiles, issue);
  return patch;
}
```

On each runner pass, `run` starts from the top.

For `ctx.tool(key, tool, input)`:

1. Validate input.
2. Look up prior events by `threadId + scopeKey + stepKey`.
3. If a completed matching tool effect exists, decode output and return it.
4. If a failed matching tool effect exists, throw `ToolFailedError`.
5. If a pending matching tool effect exists, suspend this runner pass with no new events and leave the thread waiting for worker completion.
6. If no matching effect exists, append one `tool.requested` event and suspend this runner pass.
7. If the durable identity exists for a different effect kind, throw `ReplayMismatchError`.

The first slice should use an internal control-flow sentinel such as `AgentSuspended`. `ctx.tool()` must not block the process waiting for the worker.

The same replay model applies to later durable effects. For example, `ctx.gate` will append `gate.created`, mark the thread waiting or blocked, and exit the runner pass. A later `gate.resolved` event wakes the runner, which replays to the same gate and returns the stored resolution.

## Initial Type Targets

```ts
export type MaybePromise<T> = T | Promise<T>;

export interface AgentContract<
  Name extends string = string,
  Input = unknown,
  Output = unknown,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> {
  name: Name;
  description?: string;
  input?: Schema<Input>;
  output?: Schema<Output>;
  tools?: Tools;
  run?: (
    context: AgentContext<Tools>,
    input: Input,
  ) => MaybePromise<Output>;
  planner?: AgentPlanner;
}

export interface AgentPlanner {
  plan(
    threadId: string,
    events: readonly ThreadEvent[],
  ): MaybePromise<AgentPlan | null>;
}

export interface AgentContext<
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> {
  readonly threadId: string;
  readonly actor: Actor;
  readonly signal: AbortSignal;
  tool<Input, Output>(
    key: string,
    tool: ToolContract<string, Input, Output>,
    input: Input,
    options?: ToolCallOptions,
  ): Promise<Output>;
}
```

Validation rule: an agent must provide either `run` or `planner`. If both are provided, `run` is preferred by the authoring adapter unless runtime explicitly requests planner mode.

## Implementation Order

1. Add public authoring aliases and compatibility types at root.
2. Add optional `scopeKey` and `stepKey` to the TypeScript event model.
3. Make `AgentPlanner.plan` async-compatible.
4. Add `AgentContract.run?` and validation.
5. Implement the run-to-planner adapter with replay-based suspension.
6. Implement `AgentContext.tool` over existing `tool.requested`, `tool.completed`, and `tool.failed` events.
7. Migrate the Steel docs sync agent first.
8. Add tests for replay, pending tools, completed tools, duplicate prevention, decode failure, and replay mismatch.

## Later Slices

### Tool Output Migration

After `ctx.tool` exists:

1. Relax `ToolContract` output from `Output extends ToolCompletionOutput` to arbitrary `Output`.
2. Update `tool.completed` to support raw output plus optional summary.
3. Keep legacy output compatibility.
4. Move examples to domain outputs.

### Checkpoints

Add `ctx.checkpoint` soon after `ctx.tool` and before broad durable effect expansion.

Replay re-executes the authored function, so users need a safe place to persist expensive pure work, nondeterministic values, generated IDs, timestamps, transformed inputs, and model-prep artifacts.

Target shape:

```ts
checkpoint<Value>(
  key: string,
  compute: () => MaybePromise<Value>,
  options?: CheckpointOptions,
): Promise<Value>;
```

Runtime behavior:

- if `checkpoint.completed` exists, return the stored value
- if missing, run `compute`, store the value, and return it

Later durable helpers such as `ctx.now`, `ctx.random`, and `ctx.uuid` can build on the same model.

### Gates And Policies

Order:

1. Add first-class `GateContract` and `ctx.gate`.
2. Add policy evaluator and helpers: `allow`, `deny`, `requireGate`, `redact`.
3. Add `CapabilityContract` and `ctx.capability` on top of policies.
4. Keep `CredentialProvider` as the backend mechanism for grants.

### Effect Internals

Defer until the Promise-first surface is proven.

Best first candidates:

- `ContractToolWorker.executeTool`
- credential resolution
- observability emission
- schema decode and encode boundaries
- runner execution
- durable effect reconciliation

Public API remains Promise-first.
