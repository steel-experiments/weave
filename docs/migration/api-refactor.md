# API Refactor Upgrade Guide

## Purpose

This guide explains how to move from the planner-first Weave API to the V1 run-first authoring model introduced during the API refactor.

The new preferred style is ordinary async TypeScript backed by replay-safe durable effects. Existing planner-style agents remain supported as a compatibility path.

## What Changed

- Prefer `agent({ async run(ctx, input) { ... } })` for new agents.
- Use `ctx.tool`, `ctx.gate`, `ctx.checkpoint`, `ctx.emit`, `ctx.spawn`, `ctx.join`, `ctx.children`, and `ctx.cancelChild` for durable work.
- Tools should return raw domain-shaped outputs.
- `ToolCompletionOutput` envelopes remain supported for compatibility, but are no longer the preferred output shape.
- Runtime binding is explicit through `createWeaveRuntime` and package subpaths.
- Root and child sessions can dispatch to a target agent through `agentName`.
- Tools may declare capability metadata with `capability(...)`; runtime request policies can inspect that metadata before supported durable requests are recorded.

## Agent Authoring

### Preferred V1 Style

New agents should use `agent` with `run(ctx, input)`:

```ts
import { agent, tool, weave } from "weave/runtime";
import { z } from "zod";

const inspectIssue = tool({
  name: "github.issue.inspect",
  description: "Read a GitHub issue.",
  input: z.object({
    owner: z.string(),
    repo: z.string(),
    issueNumber: z.number().int(),
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
    return inspectIssueWithGitHub(ctx.credentials.value("github.read"), ctx.input);
  },
});

const fixBug = agent({
  name: "coding.fixBug",
  input: z.object({
    owner: z.string(),
    repo: z.string(),
    issueNumber: z.number().int(),
  }),
  tools: [inspectIssue],
  async run(ctx, input) {
    const issue = await ctx.tool("inspect-issue", inspectIssue, input);
    return { finalMessage: `Inspected ${issue.title}` };
  },
});

export const app = weave({
  name: "coding-app",
  agents: [fixBug],
});
```

The stable key, such as `"inspect-issue"`, is part of replay identity. Do not generate it from nondeterministic data.

### Legacy Planner Style

Planner-style agents still work:

```ts
import { defineAgent } from "weave/runtime";

const legacyAgent = defineAgent({
  name: "legacy.agent",
  tools,
  planner,
});
```

Use this for compatibility while migrating. New examples should prefer `agent` and `run`.

## Tool Output Migration

### Before

Older tools commonly returned an envelope:

```ts
return {
  summary: "Issue loaded",
  requiresManualApproval: false,
  data: {
    title,
    body,
    labels,
  },
};
```

That shape remains readable as legacy compatibility, including older top-level `tool.completed` envelopes. It should not be used for new tools.

### After

New tools should return the domain object directly and provide display text through `summarize`:

```ts
const inspectIssue = tool({
  name: "github.issue.inspect",
  description: "Read a GitHub issue.",
  input: IssueInput,
  output: IssueOutput,
  summarize(output) {
    return output.title;
  },
  async run(ctx) {
    return {
      title,
      body,
      labels,
    };
  },
});
```

Then `ctx.tool` returns the raw output:

```ts
const issue = await ctx.tool("inspect-issue", inspectIssue, input);
return issue.title;
```

Do not read `issue.data` for new tools.

## Runtime Binding

Authoring an app does not start runtime infrastructure. Bind storage, services, runners, and workers explicitly:

```ts
import { ThreadService, createWeaveRuntime } from "weave/runtime";
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

runtime.runnerDaemon.start();
runtime.toolDaemon.start();
```

Package subpaths are available for runtime boundaries:

- `weave`: authoring primitives and compatibility exports
- `weave/runtime`: runners, daemons, workers, thread service, credentials, and observability helpers
- `weave/postgres`: Postgres engine, pool, migrations, artifacts, and observability store
- `weave/server`: HTTP API server helpers
- `weave/testing`: deterministic mock utilities

## Stable Durable Keys

Every durable context operation needs a stable key:

```ts
await ctx.tool("inspect-issue", inspectIssue, input);
await ctx.gate("approve-remediation", gateRequest);
await ctx.emit("finding:auth-docs", findingEvent);
await ctx.spawn("spawn-research", researchAgent, input);
await ctx.join("wait-research", child);
```

Durable identity is:

```txt
threadId + scopeKey + stepKey
```

For loops, include deterministic business data:

```ts
for (const file of files) {
  await ctx.tool(`summarize-file:${file.path}`, summarizeFile, file);
}
```

If a key is reused for a different durable effect kind or changed payload, Weave raises `ReplayMismatchError`.

## Typed Events And Stable IDs

Prefer contract-based event factories for new emitted domain facts.

Before:

```ts
await ctx.emit("final-response", {
  type: "agent.response.produced",
  payload: { message },
});
```

After:

```ts
const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
});

await ctx.emit("final-response", responseProduced({ message }));
```

Use `ctx.id(key)` for deterministic durable IDs:

```ts
const findingId = ctx.id("finding:auth-docs");
```

`ctx.uuid(key)` remains as a compatibility alias, but new code should prefer `ctx.id(key)` because it communicates that the value is deterministic, not random.

## Capability Declarations

Tools can declare capability metadata for request policy inspection.

```ts
const githubRead = capability({
  name: "github.read",
  description: "Read GitHub issues and pull requests.",
  scopes: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
});

const inspectIssue = tool({
  name: "github.issue.inspect",
  description: "Read a GitHub issue.",
  input: IssueInput,
  output: IssueOutput,
  capabilities: [githubRead],
  async run(ctx) {
    return inspectIssueWithGitHub(ctx.credentials.value("github.read"), ctx.input);
  },
});
```

Capability declarations do not replace credential providers. They describe access intent and can be inspected by runtime request policies, which may allow, deny, or require approval before supported durable requests are recorded.

## Replay Safety

`agent.run` is replay-based. Weave suspends the thread, not the JavaScript continuation.

Safe inside `agent.run`:

- deterministic pure computation
- schema parsing and validation
- deterministic transformations
- durable `ctx.*` operations

Unsafe inside `agent.run`:

- raw network calls
- filesystem writes
- random IDs that must be durable
- `Date.now()` or `new Date()` values that affect durable output
- direct model calls

Route external side effects through tools. Use `ctx.checkpoint` only for local values that must be recorded and replayed.

## Parallel Durable Effects

V1 does not support arbitrary parallel durable effects:

```ts
await Promise.all([
  ctx.tool("a", toolA, input),
  ctx.tool("b", toolB, input),
]);
```

Use sequential awaits instead:

```ts
const a = await ctx.tool("a", toolA, input);
const b = await ctx.tool("b", toolB, a);
```

When detected, unsupported parallel durable effects throw `ParallelDurableEffectError` with code `PARALLEL_DURABLE_EFFECT`.

## Child Threads

Use `ctx.spawn` to start child work and `ctx.join` when the parent needs the result:

```ts
const child = await ctx.spawn("spawn-research", researchAgent, input);
const result = await ctx.join("wait-research", child);
```

Detached children retain lineage but do not block parent completion unless joined:

```ts
await ctx.spawn("spawn-background-audit", auditAgent, input, {
  detached: true,
});
```

Use `ctx.children` to list known children and `ctx.cancelChild` to record durable cancellation.

## Known Limitations

- Replay is event-log replay, not persisted JavaScript continuation capture.
- Raw side effects inside `agent.run` are unsafe.
- Arbitrary parallel durable effects are unsupported.
- `ctx.emit` supports typed event factories and raw compatibility input.
- `ctx.id` is preferred for deterministic IDs; `ctx.uuid` remains a compatibility alias.
- Capability contracts are tool metadata or input-derived capability requests; runtime request policies can inspect them for `ctx.tool` enforcement.
- Effect-style internals are not required for public V1 authoring.
- Cancelled children use failed thread semantics; there is no separate `cancelled` status yet.

## Migration Checklist

- [ ] Replace new planner code with `agent({ run(ctx, input) { ... } })` where practical.
- [ ] Move network, filesystem, model, and external side effects into tools.
- [ ] Give every durable context operation a stable key.
- [ ] Change new tools from `ToolCompletionOutput` envelopes to domain-shaped outputs.
- [ ] Add `summarize(output)` where display metadata is useful.
- [ ] Bind runtime explicitly with `createWeaveRuntime`.
- [ ] Keep planner-style agents only where compatibility or low-level control is needed.
- [ ] Run `npm test` and `npm run typecheck`.
