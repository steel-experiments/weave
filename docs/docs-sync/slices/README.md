# Steel Docs Sync Slices

This directory splits the original `../../steel-docs-sync-missing-work.md` rollup into per-slice progress documents.

The original rollup should stay as historical context until each slice document has been backfilled with actual code paths, tests, and completion notes.

## Slice Index

| Slice | Status | Document | Primary outcome |
| --- | --- | --- | --- |
| 1. App-aware Runtime Wiring | Shipped | `01-app-aware-runtime-wiring.md` | Example apps can boot custom agents and tools without duplicating daemon setup. |
| 2. Webhook Ingress | Shipped | `02-webhook-ingress.md` | GitHub Actions can start docs sync threads through signed webhook payloads. |
| 3. Session Metadata And Idempotency | Shipped | `03-session-metadata-and-idempotency.md` | Webhook metadata and duplicate delivery handling are durable. |
| 4. Artifact And Snapshot Handling | In Progress | `04-artifact-and-snapshot-handling.md` | Large source bodies stay outside events and snapshot baselines support comparison; artifact failure semantics remain open. |
| 5. Structured Audit Results | Shipped | `05-structured-audit-results.md` | CI and humans can consume stable finding summaries. |
| 6. Model-backed Review Boundary | In Progress | `06-model-backed-review-boundary.md` | Review runs behind an async tool boundary with schema-validated output. |
| 7. External Result Publishing | Planned | `07-external-result-publishing.md` | Docs sync can publish check runs, comments, or issues back to GitHub. |
| 8. Worker Reliability And Diagnostics | Shipped | `08-worker-reliability-and-diagnostics.md` | Transient failures, retries, dead letters, and diagnostics are bounded and visible. |

## Backfill Rule

For each shipped or in-progress slice, add actual completion notes before treating this directory as canonical.

Completion notes should include:

- implemented modules
- event and artifact behavior
- tests added
- commands run
- known gaps
- follow-up slices
