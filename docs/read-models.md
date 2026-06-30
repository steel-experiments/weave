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
