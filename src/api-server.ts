import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { ThreadArtifactStore } from "./artifacts.js";
import type { WeaveAppDefinition } from "./app-contract.js";
import type { AuthContext, AuthGateway, AuthSummary } from "./auth-gateway.js";
import { authRequestFromIncoming, toAuthSummary } from "./auth-gateway.js";
import type { ThreadEngine } from "./contracts.js";
import {
  ActorSchema,
  SessionMetadataSchema,
  SessionSourceSchema,
  type Actor,
  type ThreadEvent,
} from "./events.js";
import type { ThreadService } from "./thread-service.js";
import {
  NoopObservabilitySink,
  elapsedMs,
  newSpanId,
  newTraceId,
  safeEmitLog,
  safeEmitSpan,
  type ObservabilityReader,
  type ObservabilitySink,
} from "./observability.js";
import { buildThreadSummary } from "./summary.js";
import { createIntegrationRoutes } from "./integration-contract.js";

const CreateThreadBodySchema = z.object({
  prompt: z.string().min(1),
  source: SessionSourceSchema.optional(),
  agentName: z.string().min(1).optional(),
  actor: ActorSchema.optional(),
  metadata: SessionMetadataSchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const ResolveGateBodySchema = z.object({
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
});

const DeliverSignalBodySchema = z.object({
  signal: z.string().min(1),
  payload: z.unknown(),
  waitId: z.string().uuid().optional(),
  scopeKey: z.string().min(1).optional(),
  stepKey: z.string().min(1).optional(),
  actor: ActorSchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
});

type AuthenticatedRequest = {
  context: AuthContext;
  summary: AuthSummary;
};

async function authenticateRequest(
  auth: AuthGateway | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<AuthenticatedRequest | null> {
  if (!auth) {
    return null;
  }
  const authRequest = authRequestFromIncoming(request);
  const authResult = await auth.authenticate(authRequest);
  if (!authResult.authenticated) {
    writeJson(response, 401, { error: "Unauthorized", reason: authResult.reason });
    return null;
  }
  return { context: authResult.context, summary: toAuthSummary(authResult.context) };
}

async function authorizeAction(
  auth: AuthGateway,
  context: AuthContext,
  action: Parameters<AuthGateway["authorize"]>[0]["action"],
  response: ServerResponse,
): Promise<boolean> {
  const decision = await auth.authorize({ context, action });
  if (!decision.allowed) {
    writeJson(response, 403, { error: "Forbidden", reason: decision.reason });
    return false;
  }
  return true;
}

function actorFromAuth(context: AuthContext): Actor {
  return { type: "user", id: context.principal.id };
}

export type ApiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean> | boolean;

export type ApiServerOptions = {
  app?: WeaveAppDefinition;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
  observabilityReader?: ObservabilityReader;
  beforeRoutes?: readonly ApiRouteHandler[];
  auth?: AuthGateway;
};

export function createApiServer(engine: ThreadEngine, service: ThreadService, options: ApiServerOptions = {}): Server {
  const observability = options.observability ?? new NoopObservabilitySink();
  const beforeRoutes = [
    ...(options.beforeRoutes ?? []),
    ...createIntegrationRoutes(options.app?.integrations, { engine, service, auth: options.auth }),
  ];
  return createServer(async (request, response) => {
    const span = apiSpanContext(request);
    const startedAt = new Date();
    let statusCode = 500;
    try {
      await routeRequest(
        engine,
        service,
        request,
        response,
        beforeRoutes,
        options.artifactStore,
        options.observabilityReader,
        observability,
        span,
        options.auth,
      );
      statusCode = response.statusCode;
      await safeEmitLog(observability, {
        ...span,
        timestamp: nowIso(),
        level: statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info",
        message: "API request completed",
        attributes: { method: request.method ?? "GET", path: request.url ?? "/", statusCode },
      });
      await emitApiSpan(observability, span, startedAt, statusCode >= 500 ? "error" : "ok", { statusCode });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await safeEmitLog(observability, {
        ...span,
        timestamp: nowIso(),
        level: "error",
        message: "API request failed",
        attributes: { method: request.method ?? "GET", path: request.url ?? "/", error: message },
      });
      await emitApiSpan(observability, span, startedAt, "error", { error: message });
      if (!response.headersSent && !response.writableEnded) {
        writeJson(response, 500, { error: message });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });
}

async function routeRequest(
  engine: ThreadEngine,
  service: ThreadService,
  request: IncomingMessage,
  response: ServerResponse,
  beforeRoutes: readonly ApiRouteHandler[] | undefined,
  artifactStore: ThreadArtifactStore | undefined,
  observabilityReader: ObservabilityReader | undefined,
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; threadId?: string },
  auth: AuthGateway | undefined,
): Promise<void> {
  for (const route of beforeRoutes ?? []) {
    if (await route(request, response)) {
      return;
    }
  }

  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && path === "/threads") {
    const body = CreateThreadBodySchema.parse(await readJson(request));

    let authSummary: AuthSummary | undefined;
    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.start", agentName: body.agentName }, response))) return;
      authSummary = authenticated.summary;
    }

    const mergedMetadata = authSummary
      ? { ...body.metadata, auth: authSummary }
      : body.metadata;

    const session = await service.startSession({
      ...body,
      source: body.source ?? "api",
      actor: body.actor ?? { type: "user", id: "api-user" },
      metadata: mergedMetadata,
    });
    const projection = await engine.getProjection(session.threadId);
    await safeEmitLog(observability, {
      ...span,
      threadId: session.threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Thread session created",
      attributes: { hasProjection: projection !== null, hasAuth: authSummary !== undefined },
    });
    writeJson(response, 201, { ...session, projection });
    return;
  }

  const threadMatch = path.match(/^\/threads\/([^/]+)$/);
  if (method === "GET" && threadMatch) {
    const threadId = decodeURIComponent(requiredMatch(threadMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const projection = await engine.getProjection(threadId);
    if (!projection) {
      writeJson(response, 404, { error: "Thread not found" });
      return;
    }
    await safeEmitLog(observability, {
      ...span,
      threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Thread projection read",
      attributes: { status: projection.status, tailSeq: projection.tailSeq },
    });
    writeJson(response, 200, projection);
    return;
  }

  const eventsMatch = path.match(/^\/threads\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const threadId = decodeURIComponent(requiredMatch(eventsMatch, 1));
    const fromSeq = parseOptionalInt(url.searchParams.get("fromSeq"));
    const limit = parseOptionalInt(url.searchParams.get("limit"));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const events = await engine.read(threadId, { fromSeq, limit });
    await safeEmitLog(observability, {
      ...span,
      threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Thread events read",
      attributes: { count: events.length, fromSeq, limit },
    });
    writeJson(response, 200, { events });
    return;
  }

  const summaryMatch = path.match(/^\/threads\/([^/]+)\/summary$/);
  if (method === "GET" && summaryMatch) {
    const threadId = decodeURIComponent(requiredMatch(summaryMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const projection = await engine.getProjection(threadId);
    if (!projection) {
      writeJson(response, 404, { error: "Thread not found" });
      return;
    }
    const events = await engine.read(threadId);
    const summary = buildThreadSummary(projection, events);
    await safeEmitLog(observability, {
      ...span,
      threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Thread summary read",
      attributes: { status: summary.status, outcome: summary.outcome, tailSeq: summary.tailSeq },
    });
    writeJson(response, 200, summary);
    return;
  }

  const streamMatch = path.match(/^\/threads\/([^/]+)\/stream$/);
  if (method === "GET" && streamMatch) {
    const threadId = decodeURIComponent(requiredMatch(streamMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const fromSeq = resolveStreamFromSeq(request, url);
    await streamThread(engine, response, threadId, fromSeq);
    return;
  }

  const artifactsMatch = path.match(/^\/threads\/([^/]+)\/artifacts$/);
  if (method === "GET" && artifactsMatch) {
    if (!artifactStore) {
      writeJson(response, 503, { error: "Artifact store not configured" });
      return;
    }
    const threadId = decodeURIComponent(requiredMatch(artifactsMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "artifact.read", threadId }, response))) return;
    }

    const artifacts = await artifactStore.listArtifacts(threadId);
    writeJson(response, 200, { artifacts });
    return;
  }

  const inboxDiagnosticsMatch = path.match(/^\/threads\/([^/]+)\/diagnostics\/inbox$/);
  if (method === "GET" && inboxDiagnosticsMatch) {
    if (!("listInbox" in engine) || typeof engine.listInbox !== "function") {
      writeJson(response, 503, { error: "Inbox diagnostics not configured" });
      return;
    }
    const threadId = decodeURIComponent(requiredMatch(inboxDiagnosticsMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const items = await engine.listInbox(threadId);
    writeJson(response, 200, { items });
    return;
  }

  const observabilitySpansMatch = path.match(/^\/threads\/([^/]+)\/observability\/spans$/);
  if (method === "GET" && observabilitySpansMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const threadId = decodeURIComponent(requiredMatch(observabilitySpansMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const spans = await observabilityReader.listSpans(threadId);
    writeJson(response, 200, { spans });
    return;
  }

  const observabilityLogsMatch = path.match(/^\/threads\/([^/]+)\/observability\/logs$/);
  if (method === "GET" && observabilityLogsMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const threadId = decodeURIComponent(requiredMatch(observabilityLogsMatch, 1));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.read", threadId }, response))) return;
    }

    const logs = await observabilityReader.listLogs(threadId);
    writeJson(response, 200, { logs });
    return;
  }

  const signalsMatch = path.match(/^\/threads\/([^/]+)\/signals$/);
  if (method === "POST" && signalsMatch) {
    const threadId = decodeURIComponent(requiredMatch(signalsMatch, 1));
    const body = DeliverSignalBodySchema.parse(await readJson(request));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "thread.signal", threadId, signalName: body.signal }, response))) return;
      const resolvedActor = body.actor ?? actorFromAuth(authenticated.context);
      const result = await service.deliverSignal({
        threadId,
        signal: body.signal,
        payload: body.payload,
        waitId: body.waitId,
        scopeKey: body.scopeKey,
        stepKey: body.stepKey,
        actor: resolvedActor,
        idempotencyKey: body.idempotencyKey,
      });
      const projection = await engine.getProjection(threadId);
      await safeEmitLog(observability, {
        ...span,
        threadId,
        timestamp: nowIso(),
        level: "info",
        message: "Signal delivered via API",
        attributes: { signal: body.signal, waitId: result.waitId, delivered: result.delivered },
      });
      writeJson(response, 200, { ...result, projection });
      return;
    }

    const result = await service.deliverSignal({
      threadId,
      signal: body.signal,
      payload: body.payload,
      waitId: body.waitId,
      scopeKey: body.scopeKey,
      stepKey: body.stepKey,
      actor: body.actor,
      idempotencyKey: body.idempotencyKey,
    });
    const projection = await engine.getProjection(threadId);
    await safeEmitLog(observability, {
      ...span,
      threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Signal delivered via API",
      attributes: { signal: body.signal, waitId: result.waitId, delivered: result.delivered },
    });
    writeJson(response, 200, { ...result, projection });
    return;
  }

  const resolveGateMatch = path.match(/^\/threads\/([^/]+)\/gates\/([^/]+)\/resolve$/);
  if (method === "POST" && resolveGateMatch) {
    const threadId = decodeURIComponent(requiredMatch(resolveGateMatch, 1));
    const gateId = decodeURIComponent(requiredMatch(resolveGateMatch, 2));
    const body = ResolveGateBodySchema.parse(await readJson(request));

    if (auth) {
      const authenticated = await authenticateRequest(auth, request, response);
      if (!authenticated) return;
      if (!(await authorizeAction(auth, authenticated.context, { type: "gate.resolve", threadId, gateId, resolution: body.resolution }, response))) return;
      await service.resolveGate(threadId, gateId, body.resolution, body.comment, actorFromAuth(authenticated.context));
      const projection = await engine.getProjection(threadId);
      await safeEmitLog(observability, {
        ...span,
        threadId,
        timestamp: nowIso(),
        level: "info",
        message: "Gate resolved via API",
        attributes: { gateId, resolution: body.resolution, resolvedBy: authenticated.summary.principalId },
      });
      writeJson(response, 200, { projection });
      return;
    }

    await service.resolveGate(threadId, gateId, body.resolution, body.comment);
    const projection = await engine.getProjection(threadId);
    await safeEmitLog(observability, {
      ...span,
      threadId,
      timestamp: nowIso(),
      level: "info",
      message: "Gate resolved via API",
      attributes: { gateId, resolution: body.resolution },
    });
    writeJson(response, 200, { projection });
    return;
  }

  writeJson(response, 404, { error: "Not found" });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function streamThread(
  engine: ThreadEngine,
  response: ServerResponse,
  threadId: string,
  fromSeq: number,
): Promise<void> {
  const projection = await engine.getProjection(threadId);
  if (!projection) {
    writeJson(response, 404, { error: "Thread not found" });
    return;
  }

  response.statusCode = 200;
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  response.flushHeaders();

  let closed = false;
  let nextSeq = fromSeq;
  let lastKeepaliveAt = Date.now();
  const history = await engine.read(threadId, { fromSeq });
  nextSeq = writeEventBatch(response, history, nextSeq);
  const initialProjection = await engine.getProjection(threadId);
  if (!initialProjection) {
    response.end();
    return;
  }
  const initialSummary = buildThreadSummary(initialProjection, await engine.read(threadId));
  writeSummaryEvents(response, initialSummary);

  const close = (): void => {
    closed = true;
  };
  response.on("close", close);
  response.on("error", close);

  try {
    while (!closed) {
      const events = await engine.read(threadId, { fromSeq: nextSeq, limit: 100 });
      if (events.length > 0) {
        nextSeq = writeEventBatch(response, events, nextSeq);
        const latestProjection = await engine.getProjection(threadId);
        if (!latestProjection) {
          break;
        }
        const summary = buildThreadSummary(latestProjection, await engine.read(threadId));
        writeSummaryEvents(response, summary);
        lastKeepaliveAt = Date.now();
      } else if (Date.now() - lastKeepaliveAt >= 5_000) {
        writeSseEvent(response, "thread.keepalive", { threadId, timestamp: nowIso() });
        lastKeepaliveAt = Date.now();
      }

      await sleep(100);
    }
  } finally {
    response.off("close", close);
    response.off("error", close);
    if (!response.writableEnded) {
      response.end();
    }
  }
}

function writeEventBatch(response: ServerResponse, events: ThreadEvent[], nextSeq: number): number {
  let updatedNextSeq = nextSeq;
  for (const event of events) {
    writeSseEvent(response, "thread.event", event, event.seq?.toString());
    updatedNextSeq = (event.seq ?? updatedNextSeq) + 1;
  }
  return updatedNextSeq;
}

function writeSseEvent(response: ServerResponse, eventName: string, data: unknown, id?: string): void {
  if (id) {
    response.write(`id: ${id}\n`);
  }
  response.write(`event: ${eventName}\n`);
  const payload = JSON.stringify(data);
  for (const line of payload.split("\n")) {
    response.write(`data: ${line}\n`);
  }
  response.write("\n");
}

function writeSummaryEvents(response: ServerResponse, summary: ReturnType<typeof buildThreadSummary>): void {
  writeSseEvent(response, "thread.summary", summary);
  if (summary.status === "completed" || summary.status === "failed") {
    writeSseEvent(response, "thread.completed", summary);
  }
}

function apiSpanContext(request: IncomingMessage): { traceId: string; spanId: string; threadId?: string } {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const threadMatch = path.match(/^\/threads\/([^/]+)/);
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    threadId: threadMatch?.[1] ? decodeURIComponent(threadMatch[1]) : undefined,
  };
}

async function emitApiSpan(
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; threadId?: string },
  startedAt: Date,
  status: "ok" | "error",
  attributes: Record<string, unknown>,
): Promise<void> {
  await safeEmitSpan(observability, {
    ...span,
    name: "api.request",
    kind: "http",
    status,
    startedAt: startedAt.toISOString(),
    endedAt: nowIso(),
    durationMs: elapsedMs(startedAt),
    attributes,
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function requiredMatch(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (!value) {
    throw new Error("Invalid route match");
  }
  return value;
}

function resolveStreamFromSeq(request: IncomingMessage, url: URL): number {
  const lastEventIdHeader = request.headers["last-event-id"];
  const headerValue = typeof lastEventIdHeader === "string" ? parseOptionalInt(lastEventIdHeader) : undefined;
  if (headerValue !== undefined) {
    return headerValue + 1;
  }

  return parseOptionalInt(url.searchParams.get("fromSeq")) ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
