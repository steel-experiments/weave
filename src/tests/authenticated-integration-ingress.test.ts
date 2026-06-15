import assert from "node:assert/strict";
import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import { z } from "zod";
import { agent } from "../agent-contract.js";
import { createAgentPlanner } from "../agent-runner.js";
import {
  allowEveryone,
  allowUser,
  allowUserToTriggerIntegration,
  allowGroupToTriggerIntegration,
  anonymousAuth,
  authGateway,
  bearerTokenAuth,
  denyEveryone,
  toAuthSummary,
  weaveAccessPolicy,
  type AuthContext,
  type AuthRequest,
  type AuthResult,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type IdentityProvider,
  type Principal,
} from "../auth-gateway.js";
import { createApiServer, type ApiRouteHandler } from "../api-server.js";
import { capability } from "../capability-contract.js";
import { defineIntegration, type IntegrationRuntimeContext } from "../integration-contract.js";
import { weave } from "../app-contract.js";
import type { AppendOptions, AppendResult, CreateThreadOptions, FollowCursor, ReadOptions, ThreadEngine } from "../contracts.js";
import { nowIso, ThreadProjectionSchema, type ThreadEvent, type ThreadProjection } from "../events.js";
import { policy, type PolicyAuthContext } from "../policy-contract.js";
import { ThreadService } from "../thread-service.js";
import { tool } from "../tool-contract.js";

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
      (res) => {
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

type SlackEventPayload = {
  team_id: string;
  user_id: string;
  user_name: string;
  user_display_name: string;
  text: string;
  channel_id: string;
  trigger_id: string;
};

function stableSlackSubject(teamId: string, userId: string): string {
  return createHash("sha256").update(`${teamId}:${userId}`).digest("hex").slice(0, 32);
}

function slackIdentityProvider(options: {
  signingSecret: string;
  workspaceId: string;
}): IdentityProvider {
  return {
    async authenticate(request: AuthRequest): Promise<AuthResult> {
      const signature = request.headers["x-slack-signature"];
      if (!signature) {
        return { authenticated: false, reason: "Missing Slack signature" };
      }

      const body = request.headers["x-slack-body"];
      if (!body || typeof body !== "string") {
        return { authenticated: false, reason: "Missing Slack body" };
      }

      let payload: SlackEventPayload;
      try {
        payload = JSON.parse(body);
      } catch {
        return { authenticated: false, reason: "Invalid Slack payload" };
      }

      if (payload.team_id !== options.workspaceId) {
        return { authenticated: false, reason: "Workspace mismatch" };
      }

      const subject = stableSlackSubject(payload.team_id, payload.user_id);

      const principal: Principal = {
        id: subject,
        provider: "slack",
        aliases: [
          { provider: "slack", subject },
        ],
        groups: ["slack-users"],
        roles: ["requester"],
        scopes: ["slack:trigger"],
        tenantId: payload.team_id,
        organizationId: options.workspaceId,
        displayName: payload.user_display_name,
      };

      return {
        authenticated: true,
        context: {
          principal,
          source: "slack-ingress",
          authenticatedAt: nowIso(),
        },
      };
    },
  };
}

async function testIntegrationRouteAuthorsCanAccessAuthGateway(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const principal: Principal = { id: "user-1", provider: "slack", aliases: [], groups: [] };
  const auth = authGateway({
    identity: bearerTokenAuth({
      async verify(token: string) { return token === "test-token" ? principal : null; },
    }),
    access: weaveAccessPolicy({
      rules: [allowUserToTriggerIntegration("user-1", "test-integration")],
    }),
  });

  let capturedAuth: typeof auth | undefined;
  const testIntegration = defineIntegration({
    name: "test-integration",
    createRoutes(context: IntegrationRuntimeContext): readonly ApiRouteHandler[] {
      capturedAuth = context.auth;
      return [
        async (_req, res) => {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ hasAuth: context.auth !== undefined }));
          return true;
        },
      ];
    },
  });

  const app = weave({
    name: "test-app",
    agents: [],
    integrations: [testIntegration],
  });

  const server = createApiServer(engine, service, { app, auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const response = await makeRequest(server, "GET", "/test-integration/health");
    assert.equal(response.status, 200);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.hasAuth, true);
    assert.ok(capturedAuth !== undefined);
    assert.equal(capturedAuth, auth);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testIntegrationTriggerIsSupportedAction(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "slack", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "slack-ingress", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowUserToTriggerIntegration("user-1", "slack-integration")],
  });

  const allowed = await access.authorize({
    context,
    action: { type: "integration.trigger", integrationName: "slack-integration" },
  });
  assert.equal(allowed.allowed, true);

  const denied = await access.authorize({
    context,
    action: { type: "integration.trigger", integrationName: "other-integration" },
  });
  assert.equal(denied.allowed, false);

  const threadStartDecision = await access.authorize({
    context,
    action: { type: "thread.start", agentName: "any-agent" },
  });
  assert.equal(threadStartDecision.allowed, false);
}

async function testSlackUsesStableWorkspacePlusUserIdAsSubject(): Promise<void> {
  const workspaceId = "T12345678";
  const userId = "U87654321";
  const expectedSubject = stableSlackSubject(workspaceId, userId);

  const identity = slackIdentityProvider({
    signingSecret: "test-secret",
    workspaceId,
  });

  const payload: SlackEventPayload = {
    team_id: workspaceId,
    user_id: userId,
    user_name: "john.doe",
    user_display_name: "John Doe",
    text: "test message",
    channel_id: "C123",
    trigger_id: "trigger-123",
  };

  const result = await identity.authenticate({
    method: "POST",
    path: "/slack/events",
    headers: {
      "x-slack-signature": "valid-signature",
      "x-slack-body": JSON.stringify(payload),
    },
  });

  assert.equal(result.authenticated, true);
  if (result.authenticated) {
    assert.equal(result.context.principal.id, expectedSubject);
    assert.equal(result.context.principal.provider, "slack");
    assert.equal(result.context.principal.aliases.length, 1);
    assert.equal(result.context.principal.aliases[0]?.provider, "slack");
    assert.equal(result.context.principal.aliases[0]?.subject, expectedSubject);
  }
}

async function testSlackUsernameAndDisplayNameNeverUsedAsPrimaryKey(): Promise<void> {
  const workspaceId = "T12345678";
  const userId = "U87654321";
  const identity = slackIdentityProvider({
    signingSecret: "test-secret",
    workspaceId,
  });

  const payload1: SlackEventPayload = {
    team_id: workspaceId,
    user_id: userId,
    user_name: "john.doe",
    user_display_name: "John Doe",
    text: "test",
    channel_id: "C123",
    trigger_id: "trigger-1",
  };

  const result1 = await identity.authenticate({
    method: "POST",
    path: "/slack/events",
    headers: {
      "x-slack-signature": "sig1",
      "x-slack-body": JSON.stringify(payload1),
    },
  });

  const payload2: SlackEventPayload = {
    ...payload1,
    user_name: "jane.smith",
    user_display_name: "Jane Smith",
  };

  const result2 = await identity.authenticate({
    method: "POST",
    path: "/slack/events",
    headers: {
      "x-slack-signature": "sig2",
      "x-slack-body": JSON.stringify(payload2),
    },
  });

  assert.equal(result1.authenticated, true);
  assert.equal(result2.authenticated, true);
  if (result1.authenticated && result2.authenticated) {
    assert.equal(result1.context.principal.id, result2.context.principal.id);
    assert.notEqual(result1.context.principal.id, "john.doe");
    assert.notEqual(result1.context.principal.id, "John Doe");
    assert.notEqual(result1.context.principal.id, "jane.smith");
    assert.notEqual(result1.context.principal.id, "Jane Smith");
  }
}

async function testTriggerAndThreadStartAreSeparateDecisions(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "slack", aliases: [], groups: [] };
  const context: AuthContext = { principal, source: "slack-ingress", authenticatedAt: nowIso() };

  const triggerOnlyAccess = weaveAccessPolicy({
    rules: [allowUserToTriggerIntegration("user-1", "slack-integration")],
  });

  const triggerDecision = await triggerOnlyAccess.authorize({
    context,
    action: { type: "integration.trigger", integrationName: "slack-integration" },
  });
  assert.equal(triggerDecision.allowed, true);

  const threadStartDecision = await triggerOnlyAccess.authorize({
    context,
    action: { type: "thread.start", agentName: "any-agent" },
  });
  assert.equal(threadStartDecision.allowed, false);

  const threadStartOnlyAccess = weaveAccessPolicy({
    rules: [allowUser("user-1").toStartAnyAgent()],
  });

  const threadStartDecision2 = await threadStartOnlyAccess.authorize({
    context,
    action: { type: "thread.start", agentName: "any-agent" },
  });
  assert.equal(threadStartDecision2.allowed, true);

  const triggerDecision2 = await threadStartOnlyAccess.authorize({
    context,
    action: { type: "integration.trigger", integrationName: "slack-integration" },
  });
  assert.equal(triggerDecision2.allowed, false);
}

async function testAuthContextReachesRuntimeCapabilityPolicyChecks(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const workspaceId = "T12345678";
  const userId = "U87654321";
  const expectedSubject = stableSlackSubject(workspaceId, userId);

  const identity = slackIdentityProvider({
    signingSecret: "test-secret",
    workspaceId,
  });

  const auth = authGateway({
    identity,
    access: weaveAccessPolicy({
      rules: [allowUserToTriggerIntegration(expectedSubject, "slack-integration")],
    }),
  });

  let capturedAuthContext: AuthContext | undefined;
  const slackIntegration = defineIntegration({
    name: "slack-integration",
    createRoutes(context: IntegrationRuntimeContext): readonly ApiRouteHandler[] {
      return [
        async (req, res) => {
          if (!context.auth) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "No auth gateway" }));
            return true;
          }

          const body = req.headers["x-slack-body"];
          if (!body || typeof body !== "string") {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing body" }));
            return true;
          }

          const authRequest: AuthRequest = {
            method: req.method ?? "POST",
            path: req.url ?? "/slack/events",
            headers: req.headers as Record<string, string | string[] | undefined>,
          };

          const authResult = await context.auth.authenticate(authRequest);
          if (!authResult.authenticated) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: "Unauthorized", reason: authResult.reason }));
            return true;
          }

          capturedAuthContext = authResult.context;

          const triggerDecision = await context.auth.authorize({
            context: authResult.context,
            action: { type: "integration.trigger", integrationName: context.integrationName },
          });

          if (!triggerDecision.allowed) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "Forbidden", reason: triggerDecision.reason }));
            return true;
          }

          const payload = JSON.parse(body);
          const session = await context.service.startSession({
            prompt: payload.text,
            source: "api",
            actor: { type: "user", id: authResult.context.principal.id },
            metadata: {
              integration: context.integrationName,
              auth: toAuthSummary(authResult.context),
            },
          });

          res.statusCode = 201;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            threadId: session.threadId,
            principalId: authResult.context.principal.id,
            provider: authResult.context.principal.provider,
          }));
          return true;
        },
      ];
    },
  });

  const app = weave({
    name: "slack-app",
    agents: [],
    integrations: [slackIntegration],
  });

  const slackCapability = capability({
    name: "slack.thread.respond",
    description: "Respond to a Slack-started thread.",
  });
  const slackTool = tool({
    name: "test.slackRuntimePolicyTool",
    description: "Tool used by the Slack runtime policy test.",
    input: z.object({ task: z.string().min(1) }),
    output: z.object({ ok: z.boolean() }),
    capabilities: [slackCapability],
    run() {
      return { ok: true };
    },
  });
  const slackAgent = agent({
    name: "slack-runtime-agent",
    tools: [slackTool],
    async run(ctx) {
      return ctx.tool("slack-runtime-policy", slackTool, { task: "respond" });
    },
  });
  let capturedPolicyAuth: PolicyAuthContext | undefined;
  const allowSlackPolicy = policy({
    name: "test.allow-slack-runtime-policy",
    evaluate(request) {
      capturedPolicyAuth = request.auth;
      return request.auth?.principalId === expectedSubject ? { outcome: "allow" } : { outcome: "deny", reason: "missing Slack auth" };
    },
  });

  const server = createApiServer(engine, service, { app, auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const payload: SlackEventPayload = {
      team_id: workspaceId,
      user_id: userId,
      user_name: "john.doe",
      user_display_name: "John Doe",
      text: "help me with this task",
      channel_id: "C123",
      trigger_id: "trigger-123",
    };

    const response = await makeRequest(
      server,
      "POST",
      "/slack/events",
      undefined,
      {
        "x-slack-signature": "valid-signature",
        "x-slack-body": JSON.stringify(payload),
      },
    );

    assert.equal(response.status, 201);
    const body = response.body as Record<string, unknown>;
    assert.equal(body.principalId, expectedSubject);
    assert.equal(body.provider, "slack");
    assert.equal(typeof body.threadId, "string");
    const threadId = String(body.threadId);

    assert.ok(capturedAuthContext !== undefined);
    assert.equal(capturedAuthContext.principal.id, expectedSubject);
    assert.equal(capturedAuthContext.principal.provider, "slack");
    assert.equal(capturedAuthContext.source, "slack-ingress");

    const events = engine.getAllEvents();
    const sessionStarted = events.find((e) => e.type === "session.started");
    assert.ok(sessionStarted);
    if (sessionStarted && sessionStarted.type === "session.started") {
      const metadata = sessionStarted.payload.metadata;
      assert.ok(metadata);
      const authMeta = (metadata as Record<string, unknown>)["auth"] as Record<string, unknown>;
      assert.equal(authMeta.principalId, expectedSubject);
      assert.equal(authMeta.provider, "slack");
      assert.equal(authMeta.source, "slack-ingress");
      assert.deepEqual(authMeta.groups, ["slack-users"]);
      assert.deepEqual(authMeta.roles, ["requester"]);
      assert.deepEqual(authMeta.scopes, ["slack:trigger"]);
      assert.equal(authMeta.tenantId, workspaceId);
      assert.equal(authMeta.organizationId, workspaceId);
    }

    const history = events.filter((event) => event.threadId === threadId);
    const plan = await createAgentPlanner(slackAgent, slackAgent.name, { policies: [allowSlackPolicy] }).plan(threadId, history);

    assert(plan);
    assert.deepEqual(capturedPolicyAuth, {
      principalId: expectedSubject,
      provider: "slack",
      source: "slack-ingress",
      groups: ["slack-users"],
      roles: ["requester"],
      scopes: ["slack:trigger"],
      tenantId: workspaceId,
      organizationId: workspaceId,
    });
    assert.equal(plan.events[0]?.type, "policy.evaluated");
    assert.equal(plan.events[0]?.payload.outcome, "allowed");
    assert.equal(plan.events[1]?.type, "tool.requested");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testIntegrationTriggerDeniedDoesNotCreateSession(): Promise<void> {
  const engine = new MinimalEngine();
  const service = new ThreadService(engine);
  const workspaceId = "T12345678";
  const userId = "U87654321";
  const expectedSubject = stableSlackSubject(workspaceId, userId);

  const identity = slackIdentityProvider({
    signingSecret: "test-secret",
    workspaceId,
  });

  const auth = authGateway({
    identity,
    access: weaveAccessPolicy({
      rules: [allowUserToTriggerIntegration("different-user", "slack-integration")],
    }),
  });

  const slackIntegration = defineIntegration({
    name: "slack-integration",
    createRoutes(context: IntegrationRuntimeContext): readonly ApiRouteHandler[] {
      return [
        async (req, res) => {
          if (!context.auth) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "No auth gateway" }));
            return true;
          }

          const body = req.headers["x-slack-body"];
          if (!body || typeof body !== "string") {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "Missing body" }));
            return true;
          }

          const authRequest: AuthRequest = {
            method: req.method ?? "POST",
            path: req.url ?? "/slack/events",
            headers: req.headers as Record<string, string | string[] | undefined>,
          };

          const authResult = await context.auth.authenticate(authRequest);
          if (!authResult.authenticated) {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: "Unauthorized", reason: authResult.reason }));
            return true;
          }

          const triggerDecision = await context.auth.authorize({
            context: authResult.context,
            action: { type: "integration.trigger", integrationName: context.integrationName },
          });

          if (!triggerDecision.allowed) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: "Forbidden", reason: triggerDecision.reason }));
            return true;
          }

          const payload = JSON.parse(body);
          const session = await context.service.startSession({
            prompt: payload.text,
            source: "api",
            actor: { type: "user", id: authResult.context.principal.id },
          });

          res.statusCode = 201;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ threadId: session.threadId }));
          return true;
        },
      ];
    },
  });

  const app = weave({
    name: "slack-app",
    agents: [],
    integrations: [slackIntegration],
  });

  const server = createApiServer(engine, service, { app, auth });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const payload: SlackEventPayload = {
      team_id: workspaceId,
      user_id: userId,
      user_name: "john.doe",
      user_display_name: "John Doe",
      text: "help me",
      channel_id: "C123",
      trigger_id: "trigger-123",
    };

    const eventsBefore = engine.getAllEvents().length;
    const response = await makeRequest(
      server,
      "POST",
      "/slack/events",
      undefined,
      {
        "x-slack-signature": "valid-signature",
        "x-slack-body": JSON.stringify(payload),
      },
    );

    assert.equal(response.status, 403);
    assert.equal(engine.getAllEvents().length, eventsBefore);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testGroupBasedIntegrationTrigger(): Promise<void> {
  const principal: Principal = { id: "user-1", provider: "slack", aliases: [], groups: ["slack-users"] };
  const context: AuthContext = { principal, source: "slack-ingress", authenticatedAt: nowIso() };
  const access = weaveAccessPolicy({
    rules: [allowGroupToTriggerIntegration("slack-users", "slack-integration")],
  });

  const allowed = await access.authorize({
    context,
    action: { type: "integration.trigger", integrationName: "slack-integration" },
  });
  assert.equal(allowed.allowed, true);

  const otherPrincipal: Principal = { id: "user-2", provider: "slack", aliases: [], groups: [] };
  const otherContext: AuthContext = { principal: otherPrincipal, source: "slack-ingress", authenticatedAt: nowIso() };
  const denied = await access.authorize({
    context: otherContext,
    action: { type: "integration.trigger", integrationName: "slack-integration" },
  });
  assert.equal(denied.allowed, false);
}

await testIntegrationRouteAuthorsCanAccessAuthGateway();
await testIntegrationTriggerIsSupportedAction();
await testSlackUsesStableWorkspacePlusUserIdAsSubject();
await testSlackUsernameAndDisplayNameNeverUsedAsPrimaryKey();
await testTriggerAndThreadStartAreSeparateDecisions();
await testAuthContextReachesRuntimeCapabilityPolicyChecks();
await testIntegrationTriggerDeniedDoesNotCreateSession();
await testGroupBasedIntegrationTrigger();

console.log("Authenticated integration ingress tests passed");
