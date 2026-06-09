import assert from "node:assert/strict";
import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import {
  allowEveryone,
  allowGroup,
  allowGroupToDeliverSignal,
  allowGroupToReadArtifacts,
  allowGroupToReadThreads,
  allowGroupToResolveGate,
  allowService,
  allowServiceToDeliverSignal,
  allowServiceToReadArtifacts,
  allowServiceToReadThreads,
  allowServiceToResolveGate,
  allowUser,
  allowUserToDeliverSignal,
  allowUserToReadArtifacts,
  allowUserToReadThreads,
  allowUserToResolveGate,
  anonymousAuth,
  authGateway,
  authRequestFromIncoming,
  bearerTokenAuth,
  denyEveryone,
  toAuthSummary,
  weaveAccessPolicy,
  type AuthContext,
  type AuthRequest,
  type AuthResult,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type Principal,
} from "../auth-gateway.js";
import { createApiServer } from "../api-server.js";
import type { AppendOptions, AppendResult, CreateThreadOptions, FollowCursor, ReadOptions, ThreadEngine } from "../contracts.js";
import { nowIso, ThreadProjectionSchema, type ThreadEvent, type ThreadProjection } from "../events.js";
import { ThreadService } from "../thread-service.js";

async function testAuthGatewayDelegatesToIdentityAndAccess(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "test", aliases: [], groups: [] };
  let authenticatedCalled = false;
  let authorizedCalled = false;

  const gateway = authGateway({
    identity: {
      async authenticate(): Promise<AuthResult> {
        authenticatedCalled = true;
        return {
          authenticated: true,
          context: { principal, source: "test", authenticatedAt: nowIso() },
        };
      },
    },
    access: {
      async authorize(): Promise<AuthorizationDecision> {
        authorizedCalled = true;
        return { allowed: true };
      },
    },
  });

  const authRequest: AuthRequest = { method: "POST", path: "/threads", headers: {} };
  const authResult = await gateway.authenticate(authRequest);
  assert.equal(authResult.authenticated, true);
  assert.equal(authenticatedCalled, true);

  const context = (authResult as { context: AuthContext }).context;
  const decision = await gateway.authorize({ context, action: { type: "thread.start" } });
  assert.equal(decision.allowed, true);
  assert.equal(authorizedCalled, true);
}

async function testBearerTokenSuccess(): Promise<void> {
  const principal: Principal = { id: "bot-1", provider: "ci", aliases: [], groups: ["ci"] };
  const identity = bearerTokenAuth({
    async verify(token: string) {
      return token === "valid-token" ? principal : null;
    },
  });

  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    assert.equal(result.context.principal.id, "bot-1");
    assert.equal(result.context.principal.provider, "ci");
    assert.equal(result.context.source, "bearer-token");
  }
}

async function testBearerTokenMissingHeader(): Promise<void> {
  const identity = bearerTokenAuth({
    async verify() {
      return null;
    },
  });

  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: {},
  });
  assert.equal(result.authenticated, false);
  if (!result.authenticated) {
    assert.ok(result.reason.length > 0);
  }
}

async function testBearerTokenInvalidToken(): Promise<void> {
  const identity = bearerTokenAuth({
    async verify() {
      return null;
    },
  });

  const result = await identity.authenticate({
    method: "POST",
    path: "/threads",
    headers: { authorization: "Bearer bad-token" },
  });
  assert.equal(result.authenticated, false);
  if (!result.authenticated) {
    assert.equal(result.reason, "Invalid token");
  }
}

async function testAnonymousAuth(): Promise<void> {
  const gateway = anonymousAuth();
  const result = await gateway.authenticate({ method: "GET", path: "/", headers: {} });
  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    assert.equal(result.context.principal.id, "anonymous");
    assert.equal(result.context.principal.provider, "none");
    assert.equal(result.context.source, "anonymous");
  }

  const context = (result as { context: AuthContext }).context;
  const decision = await gateway.authorize({ context, action: { type: "thread.start" } });
  assert.equal(decision.allowed, true);
}

async function testAccessPolicyAllowService(): Promise<void> {
  const principal: Principal = { id: "ci-bot", provider: "ci", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "bearer-token", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowService("ci-bot").toStartAgent("repo.review")],
  });

  const allowed = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "repo.review" },
  });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "other-agent" },
  });
  assert.equal(denied.allowed, false);
}

async function testAccessPolicyAllowUser(): Promise<void> {
  const principal: Principal = { id: "user-42", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowUser("user-42").toStartAnyAgent()],
  });

  const allowed = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "any-agent" },
  });
  assert.equal(allowed.allowed, true);
}

async function testAccessPolicyAllowGroup(): Promise<void> {
  const principal: Principal = { id: "user-7", provider: "web", aliases: [], groups: ["admins"] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowGroup("admins").toStartAgent("deploy")],
  });

  const allowed = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "deploy" },
  });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "other" },
  });
  assert.equal(denied.allowed, false);
}

async function testAccessPolicyDenyEveryone(): Promise<void> {
  const principal: Principal = { id: "anyone", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [denyEveryone()],
  });

  const decision = await access.authorize({
    context,
    action: { type: "thread.start" },
  });
  assert.equal(decision.allowed, false);
}

async function testAccessPolicyAllowEveryone(): Promise<void> {
  const principal: Principal = { id: "anyone", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowEveryone()],
  });

  const decision = await access.authorize({
    context,
    action: { type: "thread.start" },
  });
  assert.equal(decision.allowed, true);
}

async function testAccessPolicyAnonymousPrincipalDenied(): Promise<void> {
  const principal: Principal = { id: "anonymous", provider: "none", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "anonymous", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowService("ci-bot").toStartAnyAgent()],
  });

  const decision = await access.authorize({
    context,
    action: { type: "thread.start" },
  });
  assert.equal(decision.allowed, false);
}

async function testToAuthSummaryExcludesTokens(): Promise<void> {
  const context: AuthContext = {
    principal: {
      id: "user-1",
      provider: "okta",
      aliases: [{ provider: "okta", subject: "sub-123" }],
      groups: ["eng"],
      displayName: "Test User",
    },
    source: "bearer-token",
    authenticatedAt: nowIso(),
  };

  const summary = toAuthSummary(context);
  assert.equal(summary.principalId, "user-1");
  assert.equal(summary.provider, "okta");
  assert.equal(summary.source, "bearer-token");
  const keys = Object.keys(summary);
  assert.deepEqual(keys.sort(), ["principalId", "provider", "source"]);
}

async function testAuthRequestFromIncoming(): Promise<void> {
  const mockRequest = {
    method: "POST",
    url: "/threads",
    headers: { authorization: "Bearer abc", "content-type": "application/json" },
  } as IncomingMessage;

  const authRequest = authRequestFromIncoming(mockRequest);
  assert.equal(authRequest.method, "POST");
  assert.equal(authRequest.path, "/threads");
  assert.equal(authRequest.headers["authorization"], "Bearer abc");
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
    const req = createRequest(method, path, body, headers, addr.port, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: res.statusCode ?? 500, body: text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
  });
}

function createRequest(
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> | undefined,
  port: number,
  callback: (res: IncomingMessage) => void,
) {
  const payload = body ? JSON.stringify(body) : undefined;
  const req = httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "content-type": "application/json",
        ...(payload ? { "content-length": Buffer.byteLength(payload).toString() } : {}),
        ...headers,
      },
    },
    callback,
  );
  if (payload) req.write(payload);
  req.end();
  return req;
}

async function testApiAuthAcceptedRecordsMetadata(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "ci-bot", provider: "ci", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) {
        return token === "good-token" ? principal : null;
      },
    }),
    access: weaveAccessPolicy({
      rules: [allowService("ci-bot").toStartAgent("repo.review")],
    }),
  });

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", "/threads", {
      prompt: "review the code",
      agentName: "repo.review",
    }, { authorization: "Bearer good-token" });

    assert.equal(response.status, 201);
    const sessionEvents = engine.getAllEvents();
    const sessionStarted = sessionEvents.find((e) => e.type === "session.started");
    assert.ok(sessionStarted);
    if (sessionStarted && sessionStarted.type === "session.started") {
      const metadata = sessionStarted.payload.metadata;
      assert.ok(metadata);
      const authMeta = (metadata as Record<string, unknown>)["auth"] as Record<string, string>;
      assert.equal(authMeta.principalId, "ci-bot");
      assert.equal(authMeta.provider, "ci");
      assert.equal(authMeta.source, "bearer-token");
      assert.equal(authMeta["accessToken"], undefined);
      assert.equal(authMeta["refreshToken"], undefined);
      assert.equal(authMeta["claims"], undefined);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiAuthDeniedDoesNotCreateSession(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify() {
        return null;
      },
    }),
    access: weaveAccessPolicy({ rules: [denyEveryone()] }),
  });

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", "/threads", {
      prompt: "do something",
    }, { authorization: "Bearer bad-token" });

    assert.equal(response.status, 401);
    assert.equal(engine.getAllEvents().length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiAuthForbiddenDoesNotCreateSession(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "user-x", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) {
        return token === "valid" ? principal : null;
      },
    }),
    access: weaveAccessPolicy({
      rules: [allowService("ci-bot").toStartAnyAgent()],
    }),
  });

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", "/threads", {
      prompt: "do something",
    }, { authorization: "Bearer valid" });

    assert.equal(response.status, 403);
    assert.equal(engine.getAllEvents().length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiNoAuthAllowsUnauthenticated(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);

  const server = createApiServer(engine, service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", "/threads", {
      prompt: "hello",
    });

    assert.equal(response.status, 201);
    const sessionEvents = engine.getAllEvents();
    const sessionStarted = sessionEvents.find((e) => e.type === "session.started");
    assert.ok(sessionStarted);
    if (sessionStarted && sessionStarted.type === "session.started") {
      const metadata = sessionStarted.payload.metadata;
      assert.equal(metadata, undefined);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await testAuthGatewayDelegatesToIdentityAndAccess();
await testBearerTokenSuccess();
await testBearerTokenMissingHeader();
await testBearerTokenInvalidToken();
await testAnonymousAuth();
await testAccessPolicyAllowService();
await testAccessPolicyAllowUser();
await testAccessPolicyAllowGroup();
await testAccessPolicyDenyEveryone();
await testAccessPolicyAllowEveryone();
await testAccessPolicyAnonymousPrincipalDenied();
await testToAuthSummaryExcludesTokens();
await testAuthRequestFromIncoming();
await testApiAuthAcceptedRecordsMetadata();
await testApiAuthDeniedDoesNotCreateSession();
await testApiAuthForbiddenDoesNotCreateSession();
await testApiNoAuthAllowsUnauthenticated();

async function testAccessPolicyAllowUserToReadThreads(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowUserToReadThreads("user-1")],
  });

  const allowed = await access.authorize({ context, action: { type: "thread.read", threadId: "t-1" } });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({ context, action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1" } });
  assert.equal(denied.allowed, false);
}

async function testAccessPolicyAllowUserToResolveGate(): Promise<void> {
  const principal: Principal = { id: "user-2", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowUserToResolveGate("user-2")],
  });

  const allowed = await access.authorize({ context, action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1", resolution: "approved" } });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({ context, action: { type: "thread.read", threadId: "t-1" } });
  assert.equal(denied.allowed, false);
}

async function testAccessPolicyAllowUserToDeliverSignal(): Promise<void> {
  const principal: Principal = { id: "user-3", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowUserToDeliverSignal("user-3")],
  });

  const allowed = await access.authorize({ context, action: { type: "thread.signal", threadId: "t-1", signalName: "approval" } });
  assert.equal(allowed.allowed, true);
}

async function testAccessPolicyAllowGroupToResolveGate(): Promise<void> {
  const principal: Principal = { id: "user-4", provider: "web", aliases: [], groups: ["approvers"] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowGroupToResolveGate("approvers")],
  });

  const allowed = await access.authorize({ context, action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1" } });
  assert.equal(allowed.allowed, true);

  const otherPrincipal: Principal = { id: "user-5", provider: "web", aliases: [], groups: [] };
  const otherContext: AuthContext = { principal: otherPrincipal, source: "session", authenticatedAt: nowIso() };
  const denied = await access.authorize({ context: otherContext, action: { type: "gate.resolve", threadId: "t-1", gateId: "g-1" } });
  assert.equal(denied.allowed, false);
}

async function testAccessPolicyAllowServiceToReadArtifacts(): Promise<void> {
  const principal: Principal = { id: "artifact-svc", provider: "ci", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "bearer-token", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowServiceToReadArtifacts("artifact-svc")],
  });

  const allowed = await access.authorize({ context, action: { type: "artifact.read", threadId: "t-1" } });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({ context, action: { type: "thread.read", threadId: "t-1" } });
  assert.equal(denied.allowed, false);
}

async function createThreadWithGate(engine: MinimalEngine, service: ThreadService): Promise<{ threadId: string; gateId: string }> {
  const session = await service.startSession({ prompt: "test", source: "test" });
  const gateId = "550e8400-e29b-41d4-a716-446655440000";
  await engine.append([
    {
      eventId: "660e8400-e29b-41d4-a716-446655440001",
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
  return { threadId: session.threadId, gateId };
}

async function testApiThreadReadAuthenticated(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "reader-1", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "reader-token" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToReadThreads("reader-1")],
    }),
  });

  const session = await service.startSession({ prompt: "hello", source: "test" });
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "GET", `/threads/${session.threadId}`, undefined, { authorization: "Bearer reader-token" });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.threadId, session.threadId);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiThreadReadDenied(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "reader-x", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "valid" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToReadThreads("other-user")],
    }),
  });

  const session = await service.startSession({ prompt: "hello", source: "test" });
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "GET", `/threads/${session.threadId}`, undefined, { authorization: "Bearer valid" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiGateResolveAuthenticatedRecordsActor(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "approver-1", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "approver-token" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToResolveGate("approver-1")],
    }),
  });

  const { threadId, gateId } = await createThreadWithGate(engine, service);
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${threadId}/gates/${gateId}/resolve`, { resolution: "approved", comment: "looks good" }, { authorization: "Bearer approver-token" });
    assert.equal(response.status, 200);

    const allEvents = engine.getAllEvents();
    const gateResolved = allEvents.find((e) => e.type === "gate.resolved");
    assert.ok(gateResolved);
    if (gateResolved && gateResolved.type === "gate.resolved") {
      assert.equal(gateResolved.actor.id, "approver-1");
      assert.equal(gateResolved.actor.type, "user");
      assert.equal(gateResolved.payload.resolution, "approved");
      assert.equal(gateResolved.payload.comment, "looks good");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiGateResolveDeniedAppendsNothing(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "unauthorized-user", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "valid" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToResolveGate("other-approver")],
    }),
  });

  const { threadId, gateId } = await createThreadWithGate(engine, service);
  const eventsBefore = engine.getAllEvents().length;
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${threadId}/gates/${gateId}/resolve`, { resolution: "approved" }, { authorization: "Bearer valid" });
    assert.equal(response.status, 403);
    assert.equal(engine.getAllEvents().length, eventsBefore);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiSignalDeliveryAuthenticated(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "signal-sender-1", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "sender-token" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToDeliverSignal("signal-sender-1")],
    }),
  });

  const session = await service.startSession({ prompt: "test", source: "test" });
  const waitId = "770e8400-e29b-41d4-a716-446655440002";
  await engine.append([
    {
      eventId: "880e8400-e29b-41d4-a716-446655440003",
      threadId: session.threadId,
      type: "signal.waiting",
      occurredAt: nowIso(),
      correlationId: session.correlationId,
      actor: { type: "system", id: "test" },
      payload: { waitId, signalName: "approval", scopeKey: "test-scope", stepKey: "test-step" },
    },
  ]);

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${session.threadId}/signals`, { signal: "approval", payload: { ok: true } }, { authorization: "Bearer sender-token" });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.delivered, true);

    const allEvents = engine.getAllEvents();
    const signalReceived = allEvents.find((e) => e.type === "signal.received");
    assert.ok(signalReceived);
    if (signalReceived && signalReceived.type === "signal.received") {
      assert.equal(signalReceived.actor.id, "signal-sender-1");
      assert.equal(signalReceived.actor.type, "user");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiSignalDeliveryDeniedAppendsNothing(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "unauthorized-sender", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "valid" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToDeliverSignal("other-sender")],
    }),
  });

  const session = await service.startSession({ prompt: "test", source: "test" });
  const waitId = "990e8400-e29b-41d4-a716-446655440004";
  await engine.append([
    {
      eventId: "aa0e8400-e29b-41d4-a716-446655440005",
      threadId: session.threadId,
      type: "signal.waiting",
      occurredAt: nowIso(),
      correlationId: session.correlationId,
      actor: { type: "system", id: "test" },
      payload: { waitId, signalName: "approval", scopeKey: "test-scope", stepKey: "test-step" },
    },
  ]);

  const eventsBefore = engine.getAllEvents().length;
  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${session.threadId}/signals`, { signal: "approval", payload: { ok: true } }, { authorization: "Bearer valid" });
    assert.equal(response.status, 403);
    assert.equal(engine.getAllEvents().length, eventsBefore);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiArtifactReadAuthenticated(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "artifact-reader", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "artifact-token" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToReadArtifacts("artifact-reader")],
    }),
  });

  const mockArtifactStore = {
    async putArtifact() { throw new Error("not implemented"); },
    async listArtifacts(_threadId: string) { return [{ artifactId: "00000000-0000-0000-0000-000000000001", threadId: _threadId, toolCallId: null, kind: "test", mediaType: "text/plain", sha256: "0".repeat(64), byteLength: 100, uri: "file:///test", sourceUrl: "https://example.com/test", createdAt: nowIso() }]; },
    async getSnapshot() { return null; },
    async putSnapshot() { throw new Error("not implemented"); },
  };

  const session = await service.startSession({ prompt: "test", source: "test" });
  const server = createApiServer(engine, service, { auth, artifactStore: mockArtifactStore });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "GET", `/threads/${session.threadId}/artifacts`, undefined, { authorization: "Bearer artifact-token" });
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.ok(Array.isArray(body.artifacts));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiArtifactReadDenied(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "unauthorized-reader", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "valid" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToReadArtifacts("other-reader")],
    }),
  });

  const mockArtifactStore = {
    async putArtifact() { throw new Error("not implemented"); },
    async listArtifacts(_threadId: string) { return []; },
    async getSnapshot() { return null; },
    async putSnapshot() { throw new Error("not implemented"); },
  };

  const session = await service.startSession({ prompt: "test", source: "test" });
  const server = createApiServer(engine, service, { auth, artifactStore: mockArtifactStore });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "GET", `/threads/${session.threadId}/artifacts`, undefined, { authorization: "Bearer valid" });
    assert.equal(response.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testApiNoAuthAllowsGateResolve(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);

  const { threadId, gateId } = await createThreadWithGate(engine, service);
  const server = createApiServer(engine, service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${threadId}/gates/${gateId}/resolve`, { resolution: "approved" });
    assert.equal(response.status, 200);

    const allEvents = engine.getAllEvents();
    const gateResolved = allEvents.find((e) => e.type === "gate.resolved");
    assert.ok(gateResolved);
    if (gateResolved && gateResolved.type === "gate.resolved") {
      assert.equal(gateResolved.actor.id, "demo-approver");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

await testAccessPolicyAllowUserToReadThreads();
await testAccessPolicyAllowUserToResolveGate();
await testAccessPolicyAllowUserToDeliverSignal();
await testAccessPolicyAllowGroupToResolveGate();
await testAccessPolicyAllowServiceToReadArtifacts();
await testApiThreadReadAuthenticated();
await testApiThreadReadDenied();
await testApiGateResolveAuthenticatedRecordsActor();
await testApiGateResolveDeniedAppendsNothing();
await testApiSignalDeliveryAuthenticated();
await testApiSignalDeliveryDeniedAppendsNothing();
await testApiArtifactReadAuthenticated();
await testApiArtifactReadDenied();
await testApiNoAuthAllowsGateResolve();

console.log("Auth gateway tests passed");
