# Research

## Purpose

This directory groups comparison and research notes that inform Weave but are not themselves the active implementation plan.

Use these docs to understand prior reasoning, external systems, and design pressure. Use slice docs and architecture docs for current work.

## How To Use This Directory

- Read research docs to understand tradeoffs and borrowed patterns.
- Promote a research conclusion into a slice doc before implementing it.
- Update the relevant architecture doc when a research conclusion becomes a core Weave decision.
- Keep speculative notes here rather than mixing them into the product north-star or slice trackers.

## Research Index

### Core Primitive Research

- `weave-primitive-research.md`: foundational technical research for durable thread semantics, event sourcing, inboxes, leases, and capability boundaries
- `similar-systems.md`: broad comparison across workflow systems, actors, event stores, streams, and agent frameworks

### Execution And Durable Workflow Comparisons

- `dbos-comparison.md`: focused DBOS comparison and integration strategy

### Stream And Storage Engine Research

- `s2-engine-research.md`: evaluation of S2 and s2-lite as possible event stream infrastructure

### Runtime And Operator System Research

- `ecc-analysis.md`: analysis of ECC as an adjacent runtime/operator system
- `ecc-features-for-weave.md`: focused ECC feature analysis for security, skills, instincts, and memory

## Promotion Rule

Research should become implementation only after it is linked from one of these places:

- a slice document under `../docs-sync/slices/`, a host application, or another vertical
- a core architecture doc such as `../architecture.md`, `../interface.md`, `../event-taxonomy.md`, or `../runnable-inbox.md`
- a product north-star doc, such as a host application's `docs/overview.md`

Until then, treat it as useful context, not committed direction.
