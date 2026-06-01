# Package Subpaths Runtime Boundary Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-01`
- Owner: `weave-core`

## Goal

Separate authoring imports from runtime, storage, server, and testing imports without breaking the existing root export.

## Non-goals

- Do not remove existing root exports.
- Do not publish compiled package artifacts.
- Do not redesign runtime binding.

## User Outcome

As a Weave app author, I can keep app definitions on `weave` and import runtime wiring from targeted subpaths:

```ts
import { agent, tool, weave } from "weave";
import { createWeaveRuntime, ThreadService } from "weave/runtime";
import { PostgresThreadEngine, createPool } from "weave/postgres";
import { createApiServer } from "weave/server";
```

## Architecture Impact

- Adds package exports for:
  - `weave/runtime`
  - `weave/postgres`
  - `weave/server`
  - `weave/testing`
- Keeps `weave` root backward-compatible.
- Adds thin entrypoint files instead of moving implementation modules.
- Updates SRE and Steel runtime scripts to use subpaths.
- Keeps agent/tool/app authoring files importing from root `weave`.

## Acceptance Criteria

- [x] Root `weave` imports still work.
- [x] `weave/runtime` exports runtime orchestration, runner, worker, thread service, credentials, and observability helpers.
- [x] `weave/postgres` exports Postgres engine, pool, migrations, artifacts, and observability store.
- [x] `weave/server` exports API server helpers and server-facing types.
- [x] `weave/testing` exports mock test utilities.
- [x] Examples compile using subpaths for runtime/storage/server wiring.

## Completion Notes

Changed modules:

- `package.json`: adds subpath exports.
- `src/runtime-entry.ts`: runtime subpath re-exports.
- `src/postgres-entry.ts`: Postgres/storage subpath re-exports.
- `src/server-entry.ts`: server subpath re-exports.
- `src/testing-entry.ts`: testing subpath re-exports.
- `examples/sre-demo/src/index.ts`: uses runtime/postgres/server subpaths.
- `examples/steel-docs-sync/src/index.ts`, `webhook-demo.ts`, and `server.ts`: use runtime/postgres/server subpaths.
- `docs/declarative-api.md`: documents subpath usage.

Known follow-ups:

- Decide when root exports should stop exposing runtime internals.
- Add a stable `weave/inspect` subpath if summaries/timelines grow beyond lightweight root helpers.
