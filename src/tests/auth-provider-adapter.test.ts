import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import {
  allowGroupToResolveGate,
  allowRole,
  allowScope,
  allowTenant,
  allowOrganization,
  authGateway,
  bearerTokenAuth,
  defaultAccessContext,
  denyEveryone,
  weaveAccessPolicy,
  type AuthContext,
  type AuthResult,
  type Principal,
} from "../auth-gateway.js";
import {
  createAuthProviderAdapter,
  createIdentityAdapterContractTests,
  jwtAuth,
  type AuthProviderAdapter,
  type ClaimNormalizer,
  type NormalizedClaims,
} from "../auth-provider-adapter.js";
import { createApiServer } from "../runtime/api-server.js";
import { ThreadService } from "../thread-service.js";
import type { AppendOptions, AppendResult, CreateThreadOptions, FollowCursor, ReadOptions, ThreadEngine } from "../contracts.js";
import { nowIso, ThreadProjectionSchema, type ThreadEvent, type ThreadProjection } from "../events.js";

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payloadPart = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${payloadPart}`;
  const signature = base64UrlEncode(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${signature}`;
}

const TEST_SECRET = "test-secret-for-contract-tests-only";

function makeTestJwt(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: "user-42",
    iss: "test-issuer",
    aud: "weave-api",
    exp: now + 3600,
    iat: now,
    groups: ["approvers", "engineers"],
    roles: ["admin"],
    scope: "threads.read gates.resolve",
    tid: "tenant-abc",
    org_id: "org-xyz",
    email: "user42@example.com",
    preferred_username: "user42",
    name: "Test User 42",
    ...overrides,
  }, TEST_SECRET);
}

class MinimalEngine implements ThreadEngine {
  private readonly threads = new Map<string, CreateThreadOptions & { rootThreadId: string }>();
  private readonly events: ThreadEvent[] = [];

  async createThread(threadId: string, options: CreateThreadOptions = {}): Promise<void> {
    if (!this.threads.has(threadId)) {
      this.threads.set(threadId, { ...options, rootThreadId: options.rootThreadId ?? threadId });
    }
  }

  async append(events: ThreadEvent[], _options?: AppendOptions): Promise<AppendResult> {
    const firstSeq = this.events.length;
    for (const event of events) {
      this.events.push({ ...event, seq: this.events.length } as ThreadEvent);
    }
    return { firstSeq, lastSeq: this.events.length - 1 };
  }

  async read(threadId: string, options: ReadOptions = {}): Promise<ThreadEvent[]> {
    const fromSeq = options.fromSeq ?? 0;
    const filtered = this.events.filter((e) => e.threadId === threadId && (e.seq ?? 0) >= fromSeq);
    return options.limit === undefined ? filtered : filtered.slice(0, options.limit);
  }

  async *follow(): AsyncIterable<ThreadEvent> {}

  async getTail(): Promise<{ tailSeq: number; updatedAt: string }> {
    return { tailSeq: Math.max(0, this.events.length - 1), updatedAt: nowIso() };
  }

  async getProjection(threadId: string): Promise<ThreadProjection | null> {
    if (!this.threads.has(threadId)) return null;
    const threadEvents = this.events.filter((e) => e.threadId === threadId);
    return ThreadProjectionSchema.parse({
      threadId,
      status: threadEvents.length > 0 ? "waiting" : "idle",
      tailSeq: threadEvents.length,
      activeLeaseOwnerId: null,
      pendingGateIds: [],
      parentThreadId: null,
      rootThreadId: threadId,
      parentScopeKey: null,
      parentStepKey: null,
      updatedAt: nowIso(),
    });
  }

  getAllEvents(): readonly ThreadEvent[] {
    return this.events;
  }
}

function makeRequest(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") {
      reject(new Error("Server not listening"));
      return;
    }
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          ...(payload ? { "content-length": Buffer.byteLength(payload).toString() } : {}),
          ...headers,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function testJwtAdapterAuthenticatesValidToken(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET, issuer: "test-issuer", audience: "weave-api" });
  const token = makeTestJwt();
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    assert.equal(result.context.principal.id, "jwt:user-42");
    assert.equal(result.context.principal.provider, "test-issuer");
    assert.deepEqual([...result.context.principal.groups].sort(), ["approvers", "engineers"]);
    assert.deepEqual([...(result.context.principal.roles ?? [])], ["admin"]);
    assert.deepEqual([...(result.context.principal.scopes ?? [])].sort(), ["gates.resolve", "threads.read"]);
    assert.equal(result.context.principal.tenantId, "tenant-abc");
    assert.equal(result.context.principal.organizationId, "org-xyz");
  }
}

async function testJwtAdapterRejectsInvalidSecret(): Promise<void> {
  const identity = jwtAuth({ secret: "wrong-secret", issuer: "test-issuer", audience: "weave-api" });
  const token = makeTestJwt();
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterRejectsExpiredToken(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET });
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({ sub: "user-1", iss: "test", exp: now - 100 }, TEST_SECRET);
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterRejectsWrongIssuer(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET, issuer: "expected-issuer" });
  const token = makeTestJwt({ iss: "wrong-issuer" });
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterRejectsWrongAudience(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET, audience: "expected-aud" });
  const token = makeTestJwt({ aud: "wrong-aud" });
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterRejectsMalformedToken(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET });
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: "Bearer not.a.valid.jwt" },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterRejectsNonHS256(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET });
  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64UrlEncode(Buffer.from(JSON.stringify({ sub: "user-1" })));
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${header}.${payload}.fakesig` },
  });
  assert.equal(result.authenticated, false);
}

async function testJwtAdapterPopulatesAccessContext(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET });
  const token = makeTestJwt();
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    const { access } = result.context;
    assert.ok(access);
    assert.deepEqual([...access.groups].sort(), ["approvers", "engineers"]);
    assert.deepEqual([...access.roles], ["admin"]);
    assert.deepEqual([...access.scopes].sort(), ["gates.resolve", "threads.read"]);
    assert.equal(access.tenantId, "tenant-abc");
    assert.equal(access.organizationId, "org-xyz");
  }
}

async function testJwtAdapterEmailAndUsernameAreAliases(): Promise<void> {
  const identity = jwtAuth({ secret: TEST_SECRET });
  const token = makeTestJwt();
  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    const { principal } = result.context;
    assert.notEqual(principal.id, "user42@example.com");
    assert.notEqual(principal.id, "user42");
    const emailAlias = principal.aliases.find((a) => a.provider === "email");
    assert.ok(emailAlias);
    assert.equal(emailAlias?.subject, "user42@example.com");
    const usernameAlias = principal.aliases.find((a) => a.provider === "username");
    assert.ok(usernameAlias);
    assert.equal(usernameAlias?.subject, "user42");
  }
}

async function testCustomAdapterContract(): Promise<void> {
  const normalizer: ClaimNormalizer = (raw) => ({
    subject: String(raw["user_id"] ?? ""),
    provider: "custom-sso",
    groups: Array.isArray(raw["teams"]) ? raw["teams"].filter((t): t is string => typeof t === "string") : [],
    roles: Array.isArray(raw["permissions"]) ? raw["permissions"].filter((p): p is string => typeof p === "string") : [],
    scopes: [],
    email: raw["contact_email"] ? String(raw["contact_email"]) : undefined,
    displayName: raw["full_name"] ? String(raw["full_name"]) : undefined,
  });

  const adapter = createAuthProviderAdapter({
    providerName: "custom-sso",
    normalize: normalizer,
  });

  const rawClaims = {
    user_id: "emp-100",
    teams: ["platform", "security"],
    permissions: ["deploy", "audit.read"],
    contact_email: "emp100@corp.com",
    full_name: "Employee 100",
  };

  const principal = adapter.claimsToPrincipal(rawClaims);
  assert.equal(principal.id, "custom-sso:emp-100");
  assert.equal(principal.provider, "custom-sso");
  assert.deepEqual([...principal.groups].sort(), ["platform", "security"]);
  assert.deepEqual([...(principal.roles ?? [])].sort(), ["audit.read", "deploy"]);
  const emailAlias = principal.aliases.find((a) => a.provider === "email");
  assert.ok(emailAlias);
  assert.equal(emailAlias?.subject, "emp100@corp.com");
  assert.notEqual(principal.id, "emp100@corp.com");
}

async function testContractTestSuiteRunsForJwtAdapter(): Promise<void> {
  const validToken = makeTestJwt();
  const invalidToken = signJwt({ sub: "bad" }, "wrong-secret");

  const tests = createIdentityAdapterContractTests("jwt-hs256", () => jwtAuth({
    secret: TEST_SECRET,
    issuer: "test-issuer",
    audience: "weave-api",
  }), {
    validToken,
    invalidToken,
    expectedPrincipalId: "jwt:user-42",
    expectedProvider: "test-issuer",
    expectedGroups: ["approvers", "engineers"],
    expectedRoles: ["admin"],
    expectedScopes: ["threads.read", "gates.resolve"],
    expectedTenantId: "tenant-abc",
    expectedOrganizationId: "org-xyz",
    expectedEmail: "user42@example.com",
    expectedUsername: "user42",
  });

  for (const test of tests) {
    await test.run();
  }
}

async function testDefaultAccessContextMirrorsPrincipal(): Promise<void> {
  const principal: Principal = {
    id: "test-1",
    provider: "test",
    aliases: [],
    groups: ["g1", "g2"],
    roles: ["r1"],
    scopes: ["s1", "s2"],
    tenantId: "t1",
    organizationId: "o1",
  };
  const access = defaultAccessContext(principal);
  assert.deepEqual([...access.groups].sort(), ["g1", "g2"]);
  assert.deepEqual([...access.roles], ["r1"]);
  assert.deepEqual([...access.scopes].sort(), ["s1", "s2"]);
  assert.equal(access.tenantId, "t1");
  assert.equal(access.organizationId, "o1");
}

async function testRoleBasedAccessControl(): Promise<void> {
  const principal: Principal = {
    id: "user-1",
    provider: "jwt",
    aliases: [],
    groups: [],
    roles: ["gate-approver"],
  };
  const context: AuthContext = {
    principal,
    access: defaultAccessContext(principal),
    source: "jwt",
    authenticatedAt: nowIso(),
  };
  const access = weaveAccessPolicy({
    rules: [allowRole("gate-approver").toResolveGate()],
  });

  const allowed = await access.authorize({ context, action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1" } });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({ context, action: { type: "thread.start" } });
  assert.equal(denied.allowed, false);
}

async function testScopeBasedAccessControl(): Promise<void> {
  const principal: Principal = {
    id: "svc-1",
    provider: "oauth",
    aliases: [],
    groups: [],
    scopes: ["threads:write"],
  };
  const context: AuthContext = {
    principal,
    access: defaultAccessContext(principal),
    source: "oauth",
    authenticatedAt: nowIso(),
  };
  const access = weaveAccessPolicy({
    rules: [allowScope("threads:write").toStartAnyAgent()],
  });

  const allowed = await access.authorize({ context, action: { type: "thread.start", agentName: "any" } });
  assert.equal(allowed.allowed, true);
}

async function testTenantBasedAccessControl(): Promise<void> {
  const principal: Principal = {
    id: "user-1",
    provider: "jwt",
    aliases: [],
    groups: [],
    tenantId: "acme-corp",
  };
  const context: AuthContext = {
    principal,
    access: defaultAccessContext(principal),
    source: "jwt",
    authenticatedAt: nowIso(),
  };
  const access = weaveAccessPolicy({
    rules: [allowTenant("acme-corp")],
  });

  const allowed = await access.authorize({ context, action: { type: "thread.start" } });
  assert.equal(allowed.allowed, true);

  const otherPrincipal: Principal = { id: "user-2", provider: "jwt", aliases: [], groups: [], tenantId: "other-corp" };
  const otherContext: AuthContext = { principal: otherPrincipal, access: defaultAccessContext(otherPrincipal), source: "jwt", authenticatedAt: nowIso() };
  const denied = await access.authorize({ context: otherContext, action: { type: "thread.start" } });
  assert.equal(denied.allowed, false);
}

async function testOrganizationBasedAccessControl(): Promise<void> {
  const principal: Principal = {
    id: "user-1",
    provider: "jwt",
    aliases: [],
    groups: [],
    organizationId: "org-alpha",
  };
  const context: AuthContext = {
    principal,
    access: defaultAccessContext(principal),
    source: "jwt",
    authenticatedAt: nowIso(),
  };
  const access = weaveAccessPolicy({
    rules: [allowOrganization("org-alpha")],
  });

  const allowed = await access.authorize({ context, action: { type: "thread.start" } });
  assert.equal(allowed.allowed, true);
}

async function testEndToEndJwtGroupResolvesGate(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const identity = jwtAuth({ secret: TEST_SECRET, issuer: "test-issuer", audience: "weave-api" });
  const auth = authGateway({
    identity,
    access: weaveAccessPolicy({
      rules: [allowGroupToResolveGate("approvers")],
    }),
  });

  const session = await service.startSession({ prompt: "review needed", source: "test" });
  const gateId = "550e8400-e29b-41d4-a716-446655440010";
  await engine.append([
    {
      eventId: "660e8400-e29b-41d4-a716-446655440011",
      threadId: session.threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: session.correlationId,
      actor: { type: "system", id: "test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: "tool-result-requires-approval",
      },
    },
  ]);

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const token = makeTestJwt();
    const response = await makeRequest(
      server,
      "POST",
      `/threads/${session.threadId}/gates/${gateId}/resolve`,
      { resolution: "approved" },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(response.status, 200);

    const allEvents = engine.getAllEvents();
    const gateResolved = allEvents.find((e) => e.type === "gate.resolved");
    assert.ok(gateResolved);
    if (gateResolved && gateResolved.type === "gate.resolved") {
      assert.equal(gateResolved.actor.id, "jwt:user-42");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testEndToEndJwtGroupDeniedResolveGate(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const identity = jwtAuth({ secret: TEST_SECRET, issuer: "test-issuer", audience: "weave-api" });
  const auth = authGateway({
    identity,
    access: weaveAccessPolicy({
      rules: [allowGroupToResolveGate("super-admins")],
    }),
  });

  const session = await service.startSession({ prompt: "review needed", source: "test" });
  const gateId = "550e8400-e29b-41d4-a716-446655440020";
  await engine.append([
    {
      eventId: "660e8400-e29b-41d4-a716-446655440021",
      threadId: session.threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: session.correlationId,
      actor: { type: "system", id: "test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: "tool-result-requires-approval",
      },
    },
  ]);

  const eventsBefore = engine.getAllEvents().length;
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const token = makeTestJwt();
    const response = await makeRequest(
      server,
      "POST",
      `/threads/${session.threadId}/gates/${gateId}/resolve`,
      { resolution: "approved" },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(response.status, 403);
    assert.equal(engine.getAllEvents().length, eventsBefore);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testCustomAdapterEndToEnd(): Promise<void> {
  const normalizer: ClaimNormalizer = (raw) => ({
    subject: String(raw["sub"] ?? ""),
    provider: "internal-sso",
    groups: Array.isArray(raw["groups"]) ? raw["groups"].filter((g): g is string => typeof g === "string") : [],
    roles: [],
    scopes: [],
  });

  const adapter = createAuthProviderAdapter({
    providerName: "internal-sso",
    normalize: normalizer,
  });

  const identity = adapter.createIdentityProvider(async (token: string) => {
    if (token === "internal-valid") {
      return { sub: "emp-1", groups: ["deploy-team"] };
    }
    return null;
  });

  const auth = authGateway({
    identity,
    access: weaveAccessPolicy({
      rules: [allowGroupToResolveGate("deploy-team")],
    }),
  });

  const result = await auth.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: "Bearer internal-valid" },
  });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    assert.equal(result.context.principal.id, "internal-sso:emp-1");
    assert.ok(result.context.principal.groups.includes("deploy-team"));
    const decision = await auth.authorize({
      context: result.context,
      action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1" },
    });
    assert.equal(decision.allowed, true);
  }
}

async function testCoreHasNoProviderSdkDependency(): Promise<void> {
  const adapterModule = await import("../auth-provider-adapter.js");
  const gatewayModule = await import("../auth-gateway.js");
  assert.ok(typeof adapterModule.createAuthProviderAdapter === "function");
  assert.ok(typeof adapterModule.jwtAuth === "function");
  assert.ok(typeof adapterModule.createIdentityAdapterContractTests === "function");
  assert.ok(typeof gatewayModule.authGateway === "function");
  assert.ok(typeof gatewayModule.bearerTokenAuth === "function");
  assert.ok(typeof gatewayModule.weaveAccessPolicy === "function");
}

await testJwtAdapterAuthenticatesValidToken();
await testJwtAdapterRejectsInvalidSecret();
await testJwtAdapterRejectsExpiredToken();
await testJwtAdapterRejectsWrongIssuer();
await testJwtAdapterRejectsWrongAudience();
await testJwtAdapterRejectsMalformedToken();
await testJwtAdapterRejectsNonHS256();
await testJwtAdapterPopulatesAccessContext();
await testJwtAdapterEmailAndUsernameAreAliases();
await testCustomAdapterContract();
await testContractTestSuiteRunsForJwtAdapter();
await testDefaultAccessContextMirrorsPrincipal();
await testRoleBasedAccessControl();
await testScopeBasedAccessControl();
await testTenantBasedAccessControl();
await testOrganizationBasedAccessControl();
await testEndToEndJwtGroupResolvesGate();
await testEndToEndJwtGroupDeniedResolveGate();
await testCustomAdapterEndToEnd();
await testCoreHasNoProviderSdkDependency();

console.log("Auth provider adapter boundary tests passed");
