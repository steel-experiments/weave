# Maintainer OpenCode Security Hardening

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-10`
- Owner: `weave-maintainer`

## Goal

Close the current security gap in the Weave Maintainer OpenCode adapter before it is used for more dogfood implementation work.

## Non-goals

- Do not design the final public `weave/opencode` abstraction in this slice.
- Do not add provider-specific OpenCode session persistence.
- Do not make the maintainer fully autonomous.
- Do not rely on prompt instructions as the only security control.
- Do not allow broad shell/network/secret access because OpenCode happens to run in a worktree.

## User Outcome

As a maintainer operator, I can run OpenCode-backed implementation and repair slices knowing the adapter enforces a bounded permission profile, validates actual workspace changes, and fails closed when OpenCode asks for capabilities outside the slice boundary.

## Architecture Impact

- Keeps the immediate fix in `examples/weave-maintainer` while the hardened framework adapter is planned separately.
- Turns the current prompt-only boundary into an adapter-enforced permission profile.
- Adds actual Git diff inspection after OpenCode runs so self-reported `filesChanged` is not trusted.
- Adds explicit environment sanitization and command-argument validation before spawning OpenCode.
- Makes maintainer tests prove security failure paths, not just happy-path command execution.

## Security Model

The maintainer adapter must enforce defense in depth:

- Weave tool capabilities declare intended authority before the tool runs.
- The OpenCode CLI command is launched with an explicit permission/tool profile.
- The process is scoped to `WorkspaceRef.path` and a required branch.
- Environment variables are deny-by-default unless explicitly allowed.
- Actual workspace diff is checked after the run.
- OpenCode output is schema-validated, but never trusted as the only source of changed-file truth.

## Implementation Plan

1. Add an `OpenCodePermissionProfileSchema` to `examples/weave-maintainer/src/opencode-runner.ts`.
2. Make the default profile deny secrets, network, PR publishing, branch switching, repository operations outside the workspace, and uncontrolled shell commands.
3. Add config fields for the OpenCode CLI permission/tool flags the local OpenCode binary supports.
4. Reject runner configs that omit a permission profile unless an explicit test-only unsafe override is set.
5. Sanitize child process env to a minimum safe allowlist plus explicit config entries.
6. Capture actual changed files with Git before and after OpenCode runs.
7. Reject implementation and repair runs when actual changed files escape `allowedFiles` or the workspace root.
8. Add failure handling for OpenCode permission requests that do not match the configured profile.
9. Update maintainer prompts to describe the enforced profile, but do not rely on prompts for enforcement.
10. Document the residual risk that local CLI sandboxing still depends on the host OpenCode binary honoring its permission flags.

## Test Plan

- Unit test permission profile parsing rejects empty or unsafe profiles by default.
- Unit test command args include the expected OpenCode permission/tool flags.
- Unit test env sanitization excludes common secret variables unless explicitly allowed.
- Fake executable test attempts to report only allowed files while modifying an out-of-scope file; the runner must fail.
- Fake executable test emits permission-request output; the runner must become blocked.
- Fake executable test verifies branch mismatch still blocks before process launch.
- Fake executable test verifies timeout and max-output behavior still fail closed.
- Maintainer integration test proves `dev.opencode.implement` still returns a structured blocked result instead of crashing when security checks fail.
- Run `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [ ] OpenCode runner config requires an explicit permission profile or a named unsafe test override.
- [ ] The spawned OpenCode process receives a bounded tool/permission profile.
- [ ] Child process env is deny-by-default with an explicit allowlist.
- [ ] Actual Git diff after the run is checked against `allowedFiles` and workspace root.
- [ ] Out-of-scope actual file changes fail even when OpenCode reports an in-scope summary.
- [ ] Permission requests outside the profile become structured blocked results.
- [ ] Existing maintainer implementation and repair happy paths still work under the hardened profile.
- [ ] Documentation clearly states remaining host-level trust assumptions.

## Progress

- [ ] Define permission profile schema.
- [ ] Wire OpenCode CLI permission/tool flags.
- [ ] Add env sanitization.
- [ ] Add actual Git diff enforcement.
- [ ] Add fake executable security tests.
- [ ] Update maintainer docs.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `examples/weave-maintainer/docs/README.md`
- [ ] `examples/weave-maintainer/docs/slices/11-real-opencode-runner-adapter.md`
- [ ] `docs/agent-adapters.md`
