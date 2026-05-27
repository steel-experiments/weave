import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type { MailboxArtifactStore } from "./artifacts.js";
import type { MailboxEngine } from "./contracts.js";
import {
  ActorSchema,
  SessionMetadataSchema,
  SessionSourceSchema,
  type MailboxEvent,
} from "./events.js";
import type { MailboxService } from "./mailbox-service.js";
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
import { buildMailboxSummary } from "./summary.js";

const CreateMailboxBodySchema = z.object({
  prompt: z.string().min(1),
  source: SessionSourceSchema.optional(),
  actor: ActorSchema.optional(),
  metadata: SessionMetadataSchema.optional(),
  idempotencyKey: z.string().min(1).optional(),
});

const ResolveGateBodySchema = z.object({
  resolution: z.enum(["approved", "denied"]),
  comment: z.string().optional(),
});

export type ApiRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<boolean> | boolean;

export type ApiServerOptions = {
  artifactStore?: MailboxArtifactStore;
  observability?: ObservabilitySink;
  observabilityReader?: ObservabilityReader;
  beforeRoutes?: readonly ApiRouteHandler[];
};

export function createApiServer(engine: MailboxEngine, service: MailboxService, options: ApiServerOptions = {}): Server {
  const observability = options.observability ?? new NoopObservabilitySink();
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
        options.beforeRoutes,
        options.artifactStore,
        options.observabilityReader,
        observability,
        span,
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
  engine: MailboxEngine,
  service: MailboxService,
  request: IncomingMessage,
  response: ServerResponse,
  beforeRoutes: readonly ApiRouteHandler[] | undefined,
  artifactStore: MailboxArtifactStore | undefined,
  observabilityReader: ObservabilityReader | undefined,
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; mailboxId?: string },
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

  if (method === "POST" && path === "/mailboxes") {
    const body = CreateMailboxBodySchema.parse(await readJson(request));
    const session = await service.startSession({
      ...body,
      source: body.source ?? "api",
      actor: body.actor ?? { type: "user", id: "api-user" },
    });
    const projection = await engine.getProjection(session.mailboxId);
    await safeEmitLog(observability, {
      ...span,
      mailboxId: session.mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox session created",
      attributes: { hasProjection: projection !== null },
    });
    writeJson(response, 201, { ...session, projection });
    return;
  }

  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)$/);
  if (method === "GET" && mailboxMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(mailboxMatch, 1));
    const projection = await engine.getProjection(mailboxId);
    if (!projection) {
      writeJson(response, 404, { error: "Mailbox not found" });
      return;
    }
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox projection read",
      attributes: { status: projection.status, tailSeq: projection.tailSeq },
    });
    writeJson(response, 200, projection);
    return;
  }

  const eventsMatch = path.match(/^\/mailboxes\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(eventsMatch, 1));
    const fromSeq = parseOptionalInt(url.searchParams.get("fromSeq"));
    const limit = parseOptionalInt(url.searchParams.get("limit"));
    const events = await engine.read(mailboxId, { fromSeq, limit });
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox events read",
      attributes: { count: events.length, fromSeq, limit },
    });
    writeJson(response, 200, { events });
    return;
  }

  const summaryMatch = path.match(/^\/mailboxes\/([^/]+)\/summary$/);
  if (method === "GET" && summaryMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(summaryMatch, 1));
    const projection = await engine.getProjection(mailboxId);
    if (!projection) {
      writeJson(response, 404, { error: "Mailbox not found" });
      return;
    }
    const events = await engine.read(mailboxId);
    const summary = buildMailboxSummary(projection, events);
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
      timestamp: nowIso(),
      level: "info",
      message: "Mailbox summary read",
      attributes: { status: summary.status, outcome: summary.outcome, tailSeq: summary.tailSeq },
    });
    writeJson(response, 200, summary);
    return;
  }

  const streamMatch = path.match(/^\/mailboxes\/([^/]+)\/stream$/);
  if (method === "GET" && streamMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(streamMatch, 1));
    const fromSeq = resolveStreamFromSeq(request, url);
    await streamMailbox(engine, response, mailboxId, fromSeq);
    return;
  }

  const artifactsMatch = path.match(/^\/mailboxes\/([^/]+)\/artifacts$/);
  if (method === "GET" && artifactsMatch) {
    if (!artifactStore) {
      writeJson(response, 503, { error: "Artifact store not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(artifactsMatch, 1));
    const artifacts = await artifactStore.listArtifacts(mailboxId);
    writeJson(response, 200, { artifacts });
    return;
  }

  const inboxDiagnosticsMatch = path.match(/^\/mailboxes\/([^/]+)\/diagnostics\/inbox$/);
  if (method === "GET" && inboxDiagnosticsMatch) {
    if (!("listInbox" in engine) || typeof engine.listInbox !== "function") {
      writeJson(response, 503, { error: "Inbox diagnostics not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(inboxDiagnosticsMatch, 1));
    const items = await engine.listInbox(mailboxId);
    writeJson(response, 200, { items });
    return;
  }

  const observabilitySpansMatch = path.match(/^\/mailboxes\/([^/]+)\/observability\/spans$/);
  if (method === "GET" && observabilitySpansMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(observabilitySpansMatch, 1));
    const spans = await observabilityReader.listSpans(mailboxId);
    writeJson(response, 200, { spans });
    return;
  }

  const observabilityLogsMatch = path.match(/^\/mailboxes\/([^/]+)\/observability\/logs$/);
  if (method === "GET" && observabilityLogsMatch) {
    if (!observabilityReader) {
      writeJson(response, 503, { error: "Observability reader not configured" });
      return;
    }
    const mailboxId = decodeURIComponent(requiredMatch(observabilityLogsMatch, 1));
    const logs = await observabilityReader.listLogs(mailboxId);
    writeJson(response, 200, { logs });
    return;
  }

  const resolveGateMatch = path.match(/^\/mailboxes\/([^/]+)\/gates\/([^/]+)\/resolve$/);
  if (method === "POST" && resolveGateMatch) {
    const mailboxId = decodeURIComponent(requiredMatch(resolveGateMatch, 1));
    const gateId = decodeURIComponent(requiredMatch(resolveGateMatch, 2));
    const body = ResolveGateBodySchema.parse(await readJson(request));
    await service.resolveGate(mailboxId, gateId, body.resolution, body.comment);
    const projection = await engine.getProjection(mailboxId);
    await safeEmitLog(observability, {
      ...span,
      mailboxId,
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

async function streamMailbox(
  engine: MailboxEngine,
  response: ServerResponse,
  mailboxId: string,
  fromSeq: number,
): Promise<void> {
  const projection = await engine.getProjection(mailboxId);
  if (!projection) {
    writeJson(response, 404, { error: "Mailbox not found" });
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
  const history = await engine.read(mailboxId, { fromSeq });
  nextSeq = writeEventBatch(response, history, nextSeq);
  const initialProjection = await engine.getProjection(mailboxId);
  if (!initialProjection) {
    response.end();
    return;
  }
  const initialSummary = buildMailboxSummary(initialProjection, await engine.read(mailboxId));
  writeSummaryEvents(response, initialSummary);

  const close = (): void => {
    closed = true;
  };
  response.on("close", close);
  response.on("error", close);

  try {
    while (!closed) {
      const events = await engine.read(mailboxId, { fromSeq: nextSeq, limit: 100 });
      if (events.length > 0) {
        nextSeq = writeEventBatch(response, events, nextSeq);
        const latestProjection = await engine.getProjection(mailboxId);
        if (!latestProjection) {
          break;
        }
        const summary = buildMailboxSummary(latestProjection, await engine.read(mailboxId));
        writeSummaryEvents(response, summary);
        lastKeepaliveAt = Date.now();
      } else if (Date.now() - lastKeepaliveAt >= 5_000) {
        writeSseEvent(response, "mailbox.keepalive", { mailboxId, timestamp: nowIso() });
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

function writeEventBatch(response: ServerResponse, events: MailboxEvent[], nextSeq: number): number {
  let updatedNextSeq = nextSeq;
  for (const event of events) {
    writeSseEvent(response, "mailbox.event", event, event.seq?.toString());
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

function writeSummaryEvents(response: ServerResponse, summary: ReturnType<typeof buildMailboxSummary>): void {
  writeSseEvent(response, "mailbox.summary", summary);
  if (summary.status === "completed" || summary.status === "failed") {
    writeSseEvent(response, "mailbox.completed", summary);
  }
}

function apiSpanContext(request: IncomingMessage): { traceId: string; spanId: string; mailboxId?: string } {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const mailboxMatch = path.match(/^\/mailboxes\/([^/]+)/);
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    mailboxId: mailboxMatch?.[1] ? decodeURIComponent(mailboxMatch[1]) : undefined,
  };
}

async function emitApiSpan(
  observability: ObservabilitySink,
  span: { traceId: string; spanId: string; mailboxId?: string },
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
