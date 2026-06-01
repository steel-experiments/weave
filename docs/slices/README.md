# Slice Docs

This directory contains shared rules and templates for vertical implementation slices.

Use `template.md` when creating a new slice under a vertical such as `blade/slices/` or `docs-sync/slices/`.

## Required Pattern

Each slice should be independently reviewable.

It should define:

- what user-visible capability changes
- what Weave or Blade architecture changes
- what code paths are expected to change
- what tests prove the slice works
- what docs must be updated when it ships

The slice document should stay alive after implementation. It becomes the compact record of what was planned, what actually shipped, and what follow-up remains.

## Current Weave Core Slices

- `01-replay-authoring-api.md`: planned first slice for replay-based `agent.run` and `ctx.tool`.
- `02-tool-output-migration.md`: shipped slice for domain-shaped tool outputs with legacy compatibility.
