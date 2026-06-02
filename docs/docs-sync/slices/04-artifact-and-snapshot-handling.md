# Docs Sync Slice 4: Artifact And Snapshot Handling

## Status

- Vertical: docs-sync
- Status: In Progress
- Last updated: 2026-06-02
- Source rollup: `../../steel-docs-sync-missing-work.md`

## Goal

Keep large docs pages, `llms-full.txt`, and OpenAPI bodies outside thread events while preserving hashes, references, and baselines for drift comparison.

## User Outcome

Humans can inspect artifacts by thread, and audits can compare current source fingerprints to previous successful runs without bloating the event log.

## Current Progress

Implemented according to the rollup:

- persisted artifact metadata
- file-backed raw artifact bodies
- source snapshots
- `GET /threads/:id/artifacts`

Now implemented:

- artifact metadata and bodies are persisted through `PostgresThreadArtifactStore`
- `GET /threads/:id/artifacts` returns per-thread artifact metadata
- source snapshots are written with stable snapshot keys
- follow-up audits compare current artifact hashes to previous snapshots

Still open:

- artifact write failure injection tests
- retention and cleanup rules
- broader history APIs beyond current snapshot comparison

## Architecture Impact

This slice affects reusable Weave artifact and snapshot primitives.

Core invariant:

- thread events store durable facts and artifact references
- large raw bodies live in artifact storage
- artifact failure must not corrupt event append semantics

## Test Plan

- Source collection stores raw large bodies as artifacts, not event payloads.
- Artifact records include kind, media type, SHA-256, byte length, URI, and thread id.
- Snapshot lookup can find the previous successful baseline for `steel-dev/docs` once policy exists.
- Artifact write failure produces a visible failure and does not leave a partially committed event batch that claims success.
- Artifact API returns artifacts for a thread with stable metadata.

## Acceptance Criteria

- [x] Tool events contain references and hashes, not full large payloads.
- [x] An audit can compare current source fingerprints to a previous successful run under a documented baseline policy.
- [x] Artifacts are inspectable by thread ID.
- [ ] Artifact failure semantics are documented and tested.
- [x] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Partially shipped and aligned with current artifact architecture. The slice remains `In Progress` only for artifact failure injection semantics and retention/history policy.

Implemented modules:

- `src/artifacts.ts`: artifact and snapshot contracts plus no-op artifact store.
- `src/postgres-engine.ts` / `src/migrate.ts`: artifact and snapshot storage tables are available through Postgres migrations.
- `src/api-server.ts`: exposes `GET /threads/:id/artifacts` when an artifact store is configured.
- `examples/steel-docs-sync/src/tools.ts`: stores docs page, `llms.txt`, and OpenAPI bodies as artifacts, returns artifact references in typed tool output, and writes snapshots keyed by repository and artifact kind.
- `examples/steel-docs-sync/src/index.ts` and `webhook-demo.ts`: assert artifact references and artifact listing behavior.

Architecture alignment:

- Large source bodies stay out of thread events; `tool.completed.payload.output` contains typed artifact references and baseline comparison summaries.
- Snapshot comparison is app-level docs-sync behavior backed by reusable artifact primitives.
- Artifact APIs are exposed through `weave/server`; artifact storage is wired through `weave/postgres` and `createWeaveRuntime` app options.

Test evidence:

- `index.ts` asserts three persisted artifacts and matching thread artifact listing.
- `webhook-demo.ts` asserts artifact source URLs and a second successful audit with previous snapshot references and unchanged hashes.

Commands run during this review:

- `npm test`
- `npm run typecheck`

## Docs To Update On Completion

- [x] `../../architecture.md` for artifact primitive behavior
- [ ] `../../interface.md` if artifact APIs are exposed
- [x] `../../steel-docs-sync-example.md` for source collection behavior
- [x] this slice with exact implementation evidence
