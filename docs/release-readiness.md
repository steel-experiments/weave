# Release Readiness

This document tracks the current open-source release state for Weave. It is intentionally conservative: the repository contains a working local proof of concept, but it is not ready to publish as an npm package yet.

## Current State

- Core runtime, Postgres storage, API server, auth gateway, policies, durable effects, and examples are implemented in TypeScript.
- `npm run typecheck` and `npm test` are the baseline local verification commands.
- The package is private and exports TypeScript source for local workspace use.
- The root README documents the current local development workflow and current public API shape.

## Release Blockers

- Choose and add an open-source license in `LICENSE` and `package.json`.
- Add repository metadata once the public repository URL is final: `repository`, `homepage`, `bugs`, and maintainer ownership.
- Add a real build pipeline that emits JavaScript and declaration files to `dist`.
- Point `exports` at built files instead of `src/*.ts` before publishing.
- Finalize the publish manifest after the build pipeline exists so npm packages contain built files, public docs, and any examples intentionally shipped to consumers.
- Decide whether the kernel and runtime ship as one package with subpaths or as two separate npm packages. Current decision: one package with subpaths (see Packaging Decision below). The narrower-root question is resolved — the root `weave` export is now kernel-only.
- Add CI for `npm ci`, `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
- Add public project governance docs before launch: `CONTRIBUTING.md`, `SECURITY.md`, and a changelog or release notes policy.
- Relocate or clearly fence Blade product-planning docs (`docs/blade`, plus Blade-specific north-star material referenced from `docs/README.md`). Blade is a separate product that consumes the kernel; its product roadmap should not define the OSS kernel repository's first impression. Candidate home: the Blade app repository.
- Revoke any API keys that have ever existed in local ignored `.env` files before the repository becomes public.

## Recommended Publish Shape

- `weave`: the kernel — durable thread, event, projection, timeline, and coordination contracts. No agent-authoring or replay code.
- `weave/runtime`: the runtime — authoring primitives (`agent`/`tool`/`weave`/`event`/`capability`/`policy`/`integration`), durable `ctx.*`, runners, daemons, and tool workers. Strict superset of the kernel.
- `weave/postgres`: Postgres storage engine, migrations, pool creation, `ThreadService`, artifact store, and observability store. Kernel-only.
- `weave/server`: HTTP API server helpers (runtime).
- `weave/testing`: deterministic test utilities (runtime).
- `weave/auth`: auth gateway, access rules, JWT helper, and identity adapter contract tests. Kernel-only.
- `weave/opencode`: hardened OpenCode CLI adapter (runtime).

## Packaging Decision

Weave will be published as an open-source product, with the kernel as the headline: a Postgres-native durable thread/record/coordination substrate a host can build on without adopting any replay or agent-authoring model. The replay/agent layer (`weave/runtime`) is the optional layer on top.

Decision: ship one npm package with the subpaths above, not separate `weave` and `weave-runtime` packages — for now. Rationale:

- The boundary that matters for consumers (kernel cannot depend on runtime) is already physical (`src/` vs `src/runtime/`) and statically enforced (`core-no-runtime`), so a single package does not blur it.
- The only kernel consumer today, Blade, imports `weave` and `weave/postgres` and never touches `weave/runtime`; subpaths already give it a clean kernel-only dependency.
- Splitting into separate packages adds versioning, lockfile, and release-coordination overhead with no consumer currently asking for independent runtime releases.
- The seam is mechanical to promote later: `src/runtime/` becomes its own package depending on the kernel, with no source moves. Promote when there is a real need for independent versioning, a runtime-only consumer, or a kernel that must stay frozen while the runtime churns.

Revisit this decision at the point a build pipeline and publish manifest are added (the next packaging blockers above).

## Documentation Status

- Public-facing start point: `README.md`.
- Product narrative: `docs/what-is-weave.md`.
- Current API reference and replay semantics: `docs/declarative-api.md`.
- Architecture and vocabulary: `docs/architecture.md` and `docs/glossary.md`.
- Migration guidance: `docs/migration/api-refactor.md`.
- Internal planning material remains in `docs/`, especially Blade and slice planning docs. Keep these clearly labeled or move non-public planning material before the first public release if the repository should read as product-first rather than roadmap-first.

## Verification Checklist

Run before opening the repository publicly:

```sh
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

After a build pipeline exists, include the build command in the checklist and verify a sample consumer can import each documented package subpath from the packed tarball.
