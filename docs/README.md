# Weave Docs

This directory is the working source of truth for the project direction, architecture, and phased execution plan.

## Start Here

- `what-is-weave.md`: one-page product narrative for the vision, goals, and why Weave matters
- `overview.md`: project overview, thesis, stretch goal, and guiding principles
- `blade/overview.md`: Blade product overview and initial spec direction
- `north-star-sre-demo.md`: first product-shaped demo target for an SRE agent harness
- `steel-docs-sync-example.md`: webhook-triggered docs drift audit example for `steel-dev/docs`
- `steel-docs-sync-missing-work.md`: thread/core slices needed for the Steel docs sync example
- `roadmap.md`: phased research, planning, and development roadmap
- `architecture.md`: system shape, boundaries, and core components
- `mvp.md`: smallest useful end-to-end slice to build first
- `glossary.md`: shared language for future sessions
- `interface.md`: low-level engine and higher-level thread interfaces
- `agent-adapters.md`: how OpenCode-style and other agents can adapt to the thread model
- `similar-systems.md`: comparison of adjacent systems and how Weave differs
- `positioning.md`: product framing for Weave as a control plane above engines
- `engines-and-integrations.md`: classification of execution engines, storage engines, companions, and adapters
- `declarative-api.md`: current `defineTool`, `defineAgent`, and `defineWeaveApp` authoring API, plus deferred `defineThread` note
- `poc-scope.md`: fixed decisions and success criteria for the first proof of concept
- `engine-contracts.md`: typed engine contracts for the first Postgres-backed implementation
- `event-taxonomy.md`: strongly typed PoC event set using Zod-style schemas
- `poc-components-and-flow.md`: detailed component plan and end-to-end demo flow
- `runnable-inbox.md`: explicit inbox routing and claim model for daemon work
- `weave-research.md`: longer-form technical research and reference notes
- `ecc-analysis.md`: analysis of ECC as an adjacent runtime/operator system and what to adapt from it
- `ecc-features-for-thread.md`: focused ECC feature analysis for security, skills, instincts, and memory
- `s2-engine-research.md`: evaluation of S2 and s2-lite as a possible first engine

## Intent

These docs are meant to:

- keep the project grounded across sessions
- separate core ideas from implementation details
- prevent scope drift
- make it easier for future contributors to onboard

## Suggested Reading Order

1. `what-is-weave.md`
2. `overview.md`
3. `blade/overview.md`
4. `north-star-sre-demo.md`
5. `glossary.md`
6. `architecture.md`
7. `interface.md`
8. `agent-adapters.md`
9. `steel-docs-sync-example.md`
10. `steel-docs-sync-missing-work.md`
11. `similar-systems.md`
12. `positioning.md`
13. `engines-and-integrations.md`
14. `declarative-api.md`
15. `poc-scope.md`
16. `engine-contracts.md`
17. `event-taxonomy.md`
18. `poc-components-and-flow.md`
19. `runnable-inbox.md`
20. `mvp.md`
21. `roadmap.md`
22. `weave-research.md`
23. `ecc-analysis.md`
24. `ecc-features-for-thread.md`
25. `s2-engine-research.md`
