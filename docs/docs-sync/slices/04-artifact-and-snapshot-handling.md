# Docs Sync Slice 4: Artifact And Snapshot Handling

## Status

- Vertical: docs-sync
- Status: In Progress
- Last updated: 2026-05-29
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

Still open:

- broader history APIs
- baseline lookup policies
- retention and cleanup rules
- stronger operator-facing artifact inspection surfaces

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
- [ ] An audit can compare current source fingerprints to a previous successful run under a documented baseline policy.
- [x] Artifacts are inspectable by thread ID.
- [ ] Artifact failure semantics are documented and tested.
- [ ] Backfill exact code paths and test evidence from the implementation.

## Completion Notes

Partially shipped. This slice remains open for baseline policy, history APIs, and failure semantics.

## Docs To Update On Completion

- [ ] `../../architecture.md` for artifact primitive behavior
- [ ] `../../interface.md` if artifact APIs are exposed
- [ ] `../../steel-docs-sync-example.md` for source collection behavior
- [ ] this slice with exact implementation evidence
