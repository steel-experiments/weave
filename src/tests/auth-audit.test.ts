import assert from "node:assert/strict";
import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import {
  allowService,
  allowUserToReadThreads,
  allowUserToResolveGate,
  authGateway,
  bearerTokenAuth,
  denyEveryone,
  weaveAccessPolicy,
  type AuthContext,
  type Principal,
} from "../auth-gateway.js";
import {
  AUTH_DECISION_RECORDED,
  AuthDecisionRecordedDataSchema,
  buildAuthDecisionEvent,
  hashProviderSubject,
  principalKindFromActor,
  recordAuthDecision,
  resourceFromAction,
  type AuthDecisionRecordedData,
} from "../auth-audit.js";
import { createApiServer } from "../api-server.js";
import type { AppendOptions, AppendResult, CreateThreadOptions, ReadOptions, ThreadEngine } from "../contracts.js";
import { isDomainEvent, nowIso, ThreadEventSchema, ThreadProjectionSchema, type ThreadEvent, type ThreadProjection } from "../events.js";
import { ThreadService } from "../thread-service.js";

function authData(event: Extract<ThreadEvent, { type: "domain.event" }>): AuthDecisionRecordedData {
  return AuthDecisionRecordedDataSchema.parse(event.payload.data);
}

async function testAuthDecisionPayloadSchemaValid(): Promise<void> {
  const result = AuthDecisionRecordedDataSchema.safeParse({
    principalId: "user-1",
    principalKind: "user",
    provider: "web",
    action: "thread.start",
    decision: "allowed",
  });
  assert.equal(result.success, true);
}

async function testAuthDecisionPayloadSchemaWithAllFields(): Promise<void> {
  const result = AuthDecisionRecordedDataSchema.safeParse({
    principalId: "user-1",
    principalKind: "user",
    provider: "web",
    action: "gate.resolve",
    resource: "thread:t-1",
    decision: "denied",
    reason: "No matching access rule",
    subjectHash: "abc123def4567890",
  });
  assert.equal(result.success, true);
}

async function testAuthDecisionPayloadSchemaRejectsInvalid(): Promise<void> {
  const result = AuthDecisionRecordedDataSchema.safeParse({
    principalId: "",
    principalKind: "user",
    provider: "web",
    action: "thread.start",
    decision: "allowed",
  });
  assert.equal(result.success, false);
}

async function testAuthDecisionPayloadSchemaRejectsInvalidDecision(): Promise<void> {
  const result = AuthDecisionRecordedDataSchema.safeParse({
    principalId: "user-1",
    principalKind: "user",
    provider: "web",
    action: "thread.start",
    decision: "maybe",
  });
  assert.equal(result.success, false);
}

async function testHashProviderSubjectConsistent(): Promise<void> {
  const hash1 = hashProviderSubject("okta", "sub-123");
  const hash2 = hashProviderSubject("okta", "sub-123");
  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 16);
}

async function testHashProviderSubjectDiffersForDifferentInputs(): Promise<void> {
  const hash1 = hashProviderSubject("okta", "sub-123");
  const hash2 = hashProviderSubject("okta", "sub-456");
  const hash3 = hashProviderSubject("auth0", "sub-123");
  assert.notEqual(hash1, hash2);
  assert.notEqual(hash1, hash3);
}

async function testPrincipalKindFromActor(): Promise<void> {
  assert.equal(principalKindFromActor({ type: "user", id: "u-1" }), "user");
  assert.equal(principalKindFromActor({ type: "agent", id: "a-1" }), "agent");
  assert.equal(principalKindFromActor({ type: "system", id: "s-1" }), "system");
  assert.equal(principalKindFromActor(undefined), "user");
}

async function testResourceFromAction(): Promise<void> {
  assert.equal(resourceFromAction({ type: "thread.start", agentName: "repo.review" }), "agent:repo.review");
  assert.equal(resourceFromAction({ type: "thread.start" }), undefined);
  assert.equal(resourceFromAction({ type: "thread.read", threadId: "t-1" }), "thread:t-1");
  assert.equal(resourceFromAction({ type: "gate.resolve", threadId: "t-1", gateId: "g-1" }), "thread:t-1");
  assert.equal(resourceFromAction({ type: "thread.signal", threadId: "t-1", signalName: "approval" }), "thread:t-1");
  assert.equal(resourceFromAction({ type: "artifact.read", threadId: "t-1" }), "thread:t-1");
  assert.equal(resourceFromAction({ type: "integration.trigger", integrationName: "github" }), "integration:github");
  assert.equal(resourceFromAction({ type: "agent.run", agentName: "sre" }), "agent:sre");
}

async function testBuildAuthDecisionEventAllowed(): Promise<void> {
  const principal: Principal = {
    id: "user-1",
    provider: "web",
    aliases: [{ provider: "okta", subject: "sub-123" }],
    groups: ["eng"],
  };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };

  const event = buildAuthDecisionEvent({
    threadId: "t-1",
    context,
    action: { type: "thread.start", agentName: "sre" },
    decision: { allowed: true },
    actor: { type: "user", id: "user-1" },
    correlationId: "c-1",
  });

  assert.equal(event.type, "domain.event");
  assert.equal(event.payload.kind, AUTH_DECISION_RECORDED);
  assert.equal(event.threadId, "t-1");
  const payload = authData(event);
  assert.equal(payload.principalId, "user-1");
  assert.equal(payload.principalKind, "user");
  assert.equal(payload.provider, "web");
  assert.equal(payload.action, "thread.start");
  assert.equal(payload.resource, "agent:sre");
  assert.equal(payload.decision, "allowed");
  assert.equal(payload.reason, undefined);
  assert.ok(payload.subjectHash);
  assert.equal(payload.subjectHash, hashProviderSubject("okta", "sub-123"));
  assert.equal(event.correlationId, "c-1");
}

async function testBuildAuthDecisionEventDenied(): Promise<void> {
  const principal: Principal = {
    id: "user-2",
    provider: "ci",
    aliases: [],
    groups: [],
  };
  const context: AuthContext = { principal, source: "bearer-token", authenticatedAt: nowIso() };

  const event = buildAuthDecisionEvent({
    threadId: "t-2",
    context,
    action: { type: "gate.resolve", threadId: "t-2", gateId: "g-1" },
    decision: { allowed: false, reason: "No matching access rule" },
    actor: { type: "user", id: "user-2" },
  });

  const payload = authData(event);
  assert.equal(payload.decision, "denied");
  assert.equal(payload.reason, "No matching access rule");
  assert.equal(payload.resource, "thread:t-2");
  assert.equal(payload.subjectHash, undefined);
}

async function testBuildAuthDecisionEventContainsNoSecrets(): Promise<void> {
  const principal: Principal = {
    id: "user-1",
    provider: "okta",
    aliases: [{ provider: "okta", subject: "super-secret-subject-id" }],
    groups: ["eng"],
    displayName: "Test User",
  };
  const context: AuthContext = { principal, source: "bearer-token", authenticatedAt: nowIso() };

  const event = buildAuthDecisionEvent({
    threadId: "t-1",
    context,
    action: { type: "thread.start" },
    decision: { allowed: true },
    actor: { type: "user", id: "user-1" },
  });

  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("super-secret-subject-id"), false);
  assert.equal(serialized.includes("bearer-token"), false);
  assert.equal(serialized.includes("displayName"), false);
  assert.equal(serialized.includes("Test User"), false);
  const payload = authData(event);
  assert.ok(payload.subjectHash);
  assert.notEqual(payload.subjectHash, "super-secret-subject-id");
}

async function testBuildAuthDecisionEventIsValidThreadEvent(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };

  const event = buildAuthDecisionEvent({
    threadId: "t-1",
    context,
    action: { type: "thread.read", threadId: "t-1" },
    decision: { allowed: true },
    actor: { type: "user", id: "user-1" },
  });

  const result = ThreadEventSchema.safeParse(event);
  assert.equal(result.success, true);
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

async function testRecordAuthDecisionAppendsToEngine(): Promise<void> {
  const engine = new MinimalEngine();
  await engine.createThread("t-1");

  const principal: Principal = { id: "user-1", provider: "web", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "session", authenticatedAt: nowIso() };

  await recordAuthDecision(engine, {
    threadId: "t-1",
    context,
    action: { type: "thread.start", agentName: "sre" },
    decision: { allowed: true },
    actor: { type: "user", id: "user-1" },
  });

  const events = engine.getAllEvents();
  assert.equal(events.length, 1);
  const auditEvent = events[0];
  assert.ok(auditEvent);
  assert.equal(auditEvent?.type, "domain.event");
  if (auditEvent && isDomainEvent(auditEvent, AUTH_DECISION_RECORDED)) {
    const payload = authData(auditEvent);
    assert.equal(payload.principalId, "user-1");
    assert.equal(payload.decision, "allowed");
    assert.equal(payload.action, "thread.start");
  }
}

async function testAuthAuditEventInspectableFromThreadHistory(): Promise<void> {
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
    const body = response.body as Record<string, unknown>;
    const threadId = body.threadId as string;

    const events = await engine.read(threadId);
    const auditEvents = events.filter((e) => isDomainEvent(e, AUTH_DECISION_RECORDED));
    assert.equal(auditEvents.length, 1);

    const auditEvent = auditEvents[0];
    assert.ok(auditEvent);
    const payload = authData(auditEvent);
    assert.equal(payload.principalId, "ci-bot");
    assert.equal(payload.provider, "ci");
    assert.equal(payload.action, "thread.start");
    assert.equal(payload.decision, "allowed");
    assert.equal(payload.resource, "agent:repo.review");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testAuthAuditEventOnGateResolve(): Promise<void> {
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

  const server = createApiServer(engine, service, { auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", `/threads/${session.threadId}/gates/${gateId}/resolve`, { resolution: "approved" }, { authorization: "Bearer approver-token" });
    assert.equal(response.status, 200);

    const events = await engine.read(session.threadId);
    const auditEvents = events.filter((e) => isDomainEvent(e, AUTH_DECISION_RECORDED));
    assert.equal(auditEvents.length, 1);

    const auditEvent = auditEvents[0];
    if (auditEvent) {
      const payload = authData(auditEvent);
      assert.equal(payload.principalId, "approver-1");
      assert.equal(payload.action, "gate.resolve");
      assert.equal(payload.decision, "allowed");
      assert.equal(payload.resource, `thread:${session.threadId}`);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testAuthAuditEventOnThreadRead(): Promise<void> {
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

    const events = await engine.read(session.threadId);
    const auditEvents = events.filter((e) => isDomainEvent(e, AUTH_DECISION_RECORDED));
    assert.equal(auditEvents.length, 1);

    const auditEvent = auditEvents[0];
    if (auditEvent) {
      const payload = authData(auditEvent);
      assert.equal(payload.principalId, "reader-1");
      assert.equal(payload.action, "thread.read");
      assert.equal(payload.decision, "allowed");
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testPreThreadDenialDoesNotCreateEvents(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);

  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify() { return null; },
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

async function testPreThreadForbiddenDoesNotCreateEvents(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);

  const principal: Principal = { id: "user-x", provider: "web", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "valid" ? principal : null; },
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

async function testNoAuthDoesNotCreateAuditEvents(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);

  const server = createApiServer(engine, service);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "POST", "/threads", {
      prompt: "hello",
    });

    assert.equal(response.status, 201);
    const body = response.body as Record<string, unknown>;
    const threadId = body.threadId as string;
    const events = await engine.read(threadId);
    const auditEvents = events.filter((e) => isDomainEvent(e, AUTH_DECISION_RECORDED));
    assert.equal(auditEvents.length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

await testAuthDecisionPayloadSchemaValid();
await testAuthDecisionPayloadSchemaWithAllFields();
await testAuthDecisionPayloadSchemaRejectsInvalid();
await testAuthDecisionPayloadSchemaRejectsInvalidDecision();
await testHashProviderSubjectConsistent();
await testHashProviderSubjectDiffersForDifferentInputs();
await testPrincipalKindFromActor();
await testResourceFromAction();
await testBuildAuthDecisionEventAllowed();
await testBuildAuthDecisionEventDenied();
await testBuildAuthDecisionEventContainsNoSecrets();
await testBuildAuthDecisionEventIsValidThreadEvent();
await testRecordAuthDecisionAppendsToEngine();
await testAuthAuditEventInspectableFromThreadHistory();
await testAuthAuditEventOnGateResolve();
await testAuthAuditEventOnThreadRead();
await testPreThreadDenialDoesNotCreateEvents();
await testPreThreadForbiddenDoesNotCreateEvents();
await testNoAuthDoesNotCreateAuditEvents();

console.log("Auth audit trail tests passed");
