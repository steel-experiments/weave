# Read Models

Weave hosts should read durable thread state through read-model services rather than querying storage tables directly. `ThreadQueryService` is the public read boundary for thread heads, ancestry, recent events, reviewer child replies, and paginated thread events.

## Thread Event Pages

`ThreadQueryService.listThreadEvents({ threadId, types, cursor, limit })` returns events in ascending `seq` order.

- `cursor` is opaque. Pass the previous response's `nextCursor` back unchanged.
- `cursor` omitted or `null` starts at the beginning of the thread.
- `nextCursor: null` means the page reached the current end of the thread.
- `limit` defaults to `100` and must be an integer from `1` through `1000`.
- `types` filters events before they are returned, while the cursor still advances over the underlying thread sequence.
- Invalid cursors throw `Invalid thread event cursor`.

The service may scan multiple storage pages to satisfy a filtered request. Consumers should not infer event count or storage layout from cursor values.

## Operational Read Models

`ThreadQueryService` also exposes operational projections for host health pages:

- `listThreadInboxItems` / `countThreadInboxItems` return inbox rows by state, consumer, visibility time, claim expiry, or update time. This is the supported way to surface dead-lettered work and stale claims.
- `listThreadHealthSummaries` / `countThreadHealthSummaries` return thread heads plus the latest matching event metadata. This is the supported way to build failed or stuck thread summaries without reading storage tables.

Approvals are host-owned data, not Weave thread state. Hosts should join approval queue health from their own tables with Weave thread read models at the application boundary.

## Operational Remediation

`PostgresThreadEngine.requeueThreadInboxItems({ ids, states, expiredClaimsOnly, resetAttempts })` is the supported operational write for replaying problem inbox rows. It moves matching `dead-letter` or expired `claimed` rows back to `pending`, clears claim ownership, optionally clears error fields, and optionally resets attempts. Hosts should call this method instead of updating `weave.thread_inbox` directly.
