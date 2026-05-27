# Agent Mailbox Docs

This directory is the working source of truth for the project direction, architecture, and phased execution plan.

## Start Here

- `overview.md`: project overview, thesis, stretch goal, and guiding principles
- `north-star-sre-demo.md`: first product-shaped demo target for an SRE agent harness
- `steel-docs-sync-example.md`: webhook-triggered docs drift audit example for `steel-dev/docs`
- `steel-docs-sync-missing-work.md`: mailbox/core slices needed for the Steel docs sync example
- `roadmap.md`: phased research, planning, and development roadmap
- `architecture.md`: system shape, boundaries, and core components
- `mvp.md`: smallest useful end-to-end slice to build first
- `glossary.md`: shared language for future sessions
- `interface.md`: low-level engine and higher-level mailbox interfaces
- `agent-adapters.md`: how OpenCode-style and other agents can adapt to the mailbox model
- `similar-systems.md`: comparison of adjacent systems and how Agent Mailbox differs
- `positioning.md`: product framing for Agent Mailbox as a control plane above engines
- `engines-and-integrations.md`: classification of execution engines, storage engines, companions, and adapters
- `declarative-api.md`: current `defineTool`, `defineAgent`, and `defineMailboxApp` authoring API, plus deferred `defineMailbox` note
- `poc-scope.md`: fixed decisions and success criteria for the first proof of concept
- `engine-contracts.md`: typed engine contracts for the first Postgres-backed implementation
- `event-taxonomy.md`: strongly typed PoC event set using Zod-style schemas
- `poc-components-and-flow.md`: detailed component plan and end-to-end demo flow
- `runnable-inbox.md`: explicit inbox routing and claim model for daemon work
- `agent-mailbox-research.md`: longer-form technical research and reference notes
- `ecc-analysis.md`: analysis of ECC as an adjacent runtime/operator system and what to adapt from it
- `ecc-features-for-mailbox.md`: focused ECC feature analysis for security, skills, instincts, and memory
- `s2-engine-research.md`: evaluation of S2 and s2-lite as a possible first engine

## Intent

These docs are meant to:

- keep the project grounded across sessions
- separate core ideas from implementation details
- prevent scope drift
- make it easier for future contributors to onboard

## Suggested Reading Order

1. `overview.md`
2. `north-star-sre-demo.md`
3. `glossary.md`
4. `architecture.md`
5. `interface.md`
6. `agent-adapters.md`
7. `steel-docs-sync-example.md`
8. `steel-docs-sync-missing-work.md`
9. `similar-systems.md`
10. `positioning.md`
11. `engines-and-integrations.md`
12. `declarative-api.md`
13. `poc-scope.md`
14. `engine-contracts.md`
15. `event-taxonomy.md`
16. `poc-components-and-flow.md`
17. `runnable-inbox.md`
18. `mvp.md`
19. `roadmap.md`
20. `agent-mailbox-research.md`
21. `ecc-analysis.md`
22. `ecc-features-for-mailbox.md`
23. `s2-engine-research.md`
