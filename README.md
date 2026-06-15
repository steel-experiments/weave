# Weave

Weave is a TypeScript control plane for durable agent execution. It gives agent systems a persistent thread of record where prompts, tool requests, progress, approvals, credentials, timers, signals, child threads, policy decisions, and final outcomes are stored as replayable events.

The project is currently a working proof of concept, not a published npm package. The runtime, Postgres engine, HTTP server, auth gateway, tests, and examples are implemented in this repository and are being prepared for an open-source release.

## What Weave Provides

- Durable event-sourced threads for agent sessions.
- Replay-based `agent.run(ctx, input)` authoring with stable durable effect keys.
- Typed tools that run outside the agent process and report progress, completion, failure, summaries, credentials, artifacts, and gates.
- Human approval gates, durable sleeps, external signal waits, checkpoints, and child threads.
- Runtime request policies that can allow, deny, or require approval before supported durable requests are recorded.
- A Postgres-backed engine, inbox-based runner/tool daemons, and an HTTP API for local service mode.
- Auth gateway primitives for protecting API ingress with pluggable identity providers and access rules.
- A hardened `weave/opencode` adapter for bounded OpenCode CLI execution with explicit permission profiles, schema-validated output, sanitized env, and actual workspace diff enforcement.

Weave does not persist JavaScript continuations. When a durable operation is pending, the runner exits. A later event wakes the thread, and Weave replays `agent.run` from the beginning, returning recorded results for completed durable effects.

## Current Status

- Runtime status: usable local proof of concept.
- Storage status: Postgres-backed implementation using a dedicated `weave` schema.
- Authoring API: current preferred API is `agent`, `tool`, `weave`, `event`, `capability`, `policy`, and durable `ctx.*` operations.
- Compatibility: older planner-style agents and legacy tool output envelopes are still supported as migration paths.
- Packaging status: not npm-publish-ready yet. `package.json` remains `private: true` and exports TypeScript source for local workspace use.
- Release status: see `docs/release-readiness.md` for remaining open-source blockers.

## Requirements

- Node.js 22 or newer is recommended for the current TypeScript-first workflow.
- npm.
- Postgres for the runtime demos and service mode.

By default, local commands use:

```txt
postgres://dev:password@localhost:5432/dev
```

Set `DATABASE_URL` to use a different database.

## Install

```sh
npm install
```

## Verify

```sh
npm run typecheck
npm test
```

Run migrations without resetting existing data:

```sh
npm run db:migrate
```

## Minimal Authoring Example

```ts
import { agent, tool, weave } from "weave";
import { z } from "zod";

const echo = tool({
  name: "example.echo",
  description: "Echo text through a durable tool boundary.",
  input: z.object({ text: z.string().min(1) }),
  output: z.object({ text: z.string().min(1) }),
  summarize(output) {
    return output.text;
  },
  run(ctx) {
    return { text: ctx.input.text };
  },
});

const assistant = agent({
  name: "example.assistant",
  input: z.object({ text: z.string().min(1) }),
  tools: [echo],
  async run(ctx, input) {
    return ctx.tool("echo-input", echo, input);
  },
});

export const app = weave({
  name: "example-app",
  agents: [assistant],
});
```

Every durable operation needs a stable key such as `"echo-input"`. Do not generate durable keys from random values, wall-clock time, or other nondeterministic data.

## Runtime Binding Example

Authoring an app does not start storage, runners, workers, or HTTP services. Bind runtime infrastructure explicitly:

```ts
import { ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";
import { app } from "./app.js";

const pool = createPool();
await migrate(pool);

const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const runtime = createWeaveRuntime({
  app,
  agentName: "example.assistant",
  engine,
  service,
});

runtime.runnerDaemon.start();
runtime.toolDaemon.start();
```

## Package Boundaries

The repository currently exposes these local workspace subpaths:

- `weave`: authoring primitives plus compatibility exports.
- `weave/runtime`: runners, daemons, workers, thread service, credentials, and observability helpers.
- `weave/postgres`: Postgres engine, pool, migrations, artifact store, and observability store.
- `weave/server`: HTTP API server helpers.
- `weave/testing`: deterministic mock utilities.
- `weave/auth`: auth gateway, access rules, JWT helper, and identity adapter contract tests.
- `weave/opencode`: hardened OpenCode CLI adapter, permission profiles, capability mapping, bounded execution, env sanitization, JSON output validation, and actual Git diff enforcement.

These boundaries are the intended public shape, but the package still needs a compiled `dist` build and a narrowed publish manifest before npm publication.

## Local PoC Commands

Run the low-level end-to-end PoC:

```sh
npm run poc
```

Run the API-driven system PoC:

```sh
npm run system:poc
```

Run the local workflow dashboard:

```sh
npm run dashboard
```

The dashboard is provided by `examples/weave-maintainer`, which dogfoods Weave as a framework instead of living in core. It binds to `0.0.0.0:3010` by default and reads the configured `DATABASE_URL`.

Inspect Weave Maintainer source checkpoints:

```sh
npm run checkpoints:list -- <initiative-thread-id>
npm run checkpoints:show -- <checkpoint-id-or-sha>
npm run checkpoints:diff -- <checkpoint-id-or-sha>
npm run checkpoints:restore -- <checkpoint-id-or-sha> --confirm [--force]
```

## Service Mode

Run the API server:

```sh
npm run server
```

In separate terminals, run the background loops:

```sh
npm run daemon:runner
npm run daemon:tool
```

The API exposes thread creation, event reads, projections, summaries, streams, diagnostics, gate resolution, and signal delivery.

## Examples

- `examples/sre-demo`: deterministic gate-heavy runtime semantics demo. It uses mocked Axiom, Grafana, Sentry, deploy metadata, approval gates, credentials, observability, and remediation flow. Run with `npm run sre:demo`.
- `examples/steel-docs-sync`: deterministic docs audit workflow using run-first authoring, local fixtures, artifact storage, `ctx.tool`, and emitted domain facts. Run with `npm run steel:demo` or `npm run steel:webhook-demo`.
- `examples/simple-assistant`: model-backed assistant that routes a Kimi K2.6 call through OpenCode Zen behind a tool boundary. It requires `OPENCODE_API_KEY`. Run with `npm run assistant:demo -- "your prompt"` or `npm run assistant:server`.
- `examples/prompt-workflow-review`: prompt-driven workflow review example using durable child agents and a conservative repo-read harness. Its deterministic test runs through `npm test`; the OpenCode integration test is optional and environment-dependent.
- `examples/weave-maintainer`: dogfooded maintenance app for dashboard, gates, initiatives, and source checkpoints.

Deterministic examples double as regression assets. The model-backed assistant is optional and demonstrates the tool boundary for external model calls; Weave itself does not require a model provider.

## Destructive Demo Warning

These commands call `migrate(pool, { reset: true })` and reset only the dedicated `weave` schema in the configured database:

- `npm run poc`
- `npm run system:poc`
- `npm run sre:demo`
- `npm run steel:demo`
- `npm run steel:webhook-demo`
- `npm run assistant:demo -- "your prompt"`

Do not run reset-based demos concurrently against the same database. Use a throwaway local database for demos.

## Model-Backed Assistant Setup

Create `examples/simple-assistant/.env` from `examples/simple-assistant/.env.example` or export the variable in your shell:

```sh
OPENCODE_API_KEY=your-api-key npm run assistant:demo -- "Explain what Weave does in one sentence"
```

Run the same assistant as a local API:

```sh
npm run assistant:server
```

The server starts on port `3000` by default. If that port is busy and `PORT` is not set, it tries the next available port and prints the URL. Set `PORT=3100` to choose a specific port.

Call the convenience route:

```sh
curl -X POST http://127.0.0.1:3000/assistant \
  -H 'content-type: application/json' \
  -d '{"prompt":"Write me a poem about steel weaves"}'
```

The server also exposes the raw Weave thread API at `/threads`, `/threads/<threadId>/events`, and `/threads/<threadId>/stream`.

## Implementation Map

- `src/agent-contract.ts`: run-first agent authoring contracts and durable context API.
- `src/tool-contract.ts`: typed tool contracts, output summaries, credentials, capabilities, and gates.
- `src/app-contract.ts`: `weave` app registry.
- `src/agent-runner.ts`: replay adapter for `agent.run`, durable effects, gates, checkpoints, timers, signals, and child threads.
- `src/postgres-engine.ts`: Postgres event log, projection, leases, lineage, gates, signals, timers, and inbox persistence.
- `src/thread-service.ts`: session start, child session, gate resolution, signal delivery, child listing, and child cancellation service.
- `src/runner.ts`: one-step thread runner with durable agent failure events.
- `src/tool-worker.ts`: contract tool worker with credentials, artifacts, progress, retries, policy evidence, and output summaries.
- `src/daemons.ts`: runner and tool worker daemons backed by explicit inbox claims.
- `src/api-server.ts`: HTTP API for thread sessions, events, projections, summaries, streams, diagnostics, gates, and signals.
- `src/auth-gateway.ts`: HTTP ingress auth gateway composition.
- `src/policy-contract.ts`: request policy rules and approval policy helpers.
- `src/workspace-provider.ts`: provider-neutral workspace abstraction and git worktree provider.
- `src/opencode-adapter.ts`: reusable hardened OpenCode CLI adapter exported through `weave/opencode`.

## Docs

- `docs/what-is-weave.md`: product narrative and vision.
- `docs/declarative-api.md`: current authoring API and replay semantics.
- `docs/architecture.md`: system boundaries and primitives.
- `docs/glossary.md`: core vocabulary.
- `docs/migration/api-refactor.md`: migration guide from planner-first and legacy tool-output patterns.
- `docs/release-readiness.md`: open-source release checklist and known blockers.
- `docs/README.md`: full documentation index, including internal planning docs and Blade north-star material.
