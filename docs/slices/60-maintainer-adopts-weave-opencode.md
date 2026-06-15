# Maintainer Adopts Weave OpenCode Adapter

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-10`
- Owner: `weave-maintainer`

## Goal

Replace the maintainer's example-local OpenCode CLI runner with the hardened `weave/opencode` adapter, while keeping maintainer-specific prompts, schemas, slice orchestration, and review gates in `examples/weave-maintainer`.

## Non-goals

- Do not move the entire maintainer app back into core.
- Do not duplicate the hardened adapter implementation in the maintainer example.
- Do not loosen the maintainer security profile to preserve old behavior.
- Do not make OpenCode responsible for verification, review, PR creation, or finalization.

## User Outcome

As a maintainer operator, I can keep using `npm run initiative:run`, but OpenCode execution goes through the same hardened framework adapter that other Weave apps use.

## Architecture Impact

- `examples/weave-maintainer` becomes a consumer of `weave/opencode`.
- Maintainer-specific runner code shrinks to prompt construction and schema mapping.
- Security enforcement localizes in the framework adapter instead of drifting in an example.
- Maintainer app policy becomes explicit about which OpenCode capabilities are allowed for implementation and repair roles.

## Implementation Plan

1. Replace `examples/weave-maintainer/src/opencode-runner.ts` internals with a thin wrapper around `weave/opencode`, or delete it if direct usage is clearer.
2. Map `OpenCodeImplementerInputSchema` to the generic `weave/opencode` run input.
3. Map `RepairAgentInputSchema` to the generic `weave/opencode` run input.
4. Define maintainer implementation and repair permission profiles with separate allowed tools and shell commands.
5. Install a maintainer app policy that explicitly allows those profiles and denies unexpected OpenCode capabilities.
6. Preserve existing structured output schemas for implementation summaries and repair results.
7. Preserve actual diff enforcement for `allowedFiles` through the framework adapter.
8. Update maintainer tests to assert it imports and uses `weave/opencode` instead of carrying a standalone security implementation.
9. Update root scripts only if command names or environment variables change.

## Test Plan

- Maintainer unit tests for implementation prompt-to-adapter input mapping.
- Maintainer unit tests for repair prompt-to-adapter input mapping.
- Maintainer policy test denies an OpenCode capability not in the implementation profile.
- Maintainer policy test denies an OpenCode capability not in the repair profile.
- Fake executable tests still cover implementation success, repair success, permission denial, out-of-scope actual changes, invalid JSON, and timeout.
- Integration test through `createOpenCodeImplementationTool(...)` proves blocked adapter results become structured blocked tool outputs.
- Run `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] Maintainer OpenCode execution uses `weave/opencode`.
- [ ] Maintainer no longer owns a standalone security-sensitive OpenCode CLI implementation.
- [ ] Implementation and repair roles have distinct explicit permission profiles.
- [ ] Maintainer app policy denies unexpected OpenCode capabilities.
- [ ] Existing maintainer commands continue to work.
- [ ] Existing maintainer verification/review gates remain mandatory after OpenCode runs.
- [ ] Tests prove the maintainer cannot regress to prompt-only enforcement.

## Progress

- [ ] Wrap or replace local OpenCode runner.
- [ ] Define implementation permission profile.
- [ ] Define repair permission profile.
- [ ] Add maintainer app policy.
- [ ] Update tests and docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `examples/weave-maintainer/docs/README.md`
- [ ] `examples/weave-maintainer/docs/slices/11-real-opencode-runner-adapter.md`
- [ ] `docs/agent-adapters.md`
