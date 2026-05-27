import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createApiServer,
  type MailboxArtifactStore,
  type ApiRouteHandler,
  type MailboxEngine,
  type MailboxService,
} from "@agent-mailbox/core";
import { z } from "zod";

const webhookPath = "/webhooks/github/steel-docs-sync";
const webhookClockSkewMs = 5 * 60 * 1000;
const allowedRepository = "steel-dev/docs";
const allowedHosts = new Set(["docs.steel.dev"]);

const SteelDocsSyncWebhookPayloadSchema = z.object({
  repository: z.literal(allowedRepository),
  ref: z.string().min(1),
  sha: z.string().min(7),
  runId: z.string().min(1),
  runAttempt: z.number().int().positive(),
  eventName: z.string().min(1),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  docsBaseUrl: z.string().url(),
  llmsTxtUrl: z.string().url(),
  llmsFullTxtUrl: z.string().url().optional(),
  apiReferenceUrl: z.string().url().optional(),
  openApiSpecUrl: z.string().url().optional(),
});

export type SteelDocsSyncWebhookPayload = z.infer<typeof SteelDocsSyncWebhookPayloadSchema>;

export type SteelDocsSyncServerOptions = {
  webhookSecret: string;
  allowedHosts?: readonly string[];
  artifactStore?: MailboxArtifactStore;
};

export function createSteelDocsSyncApiServer(
  engine: MailboxEngine,
  service: MailboxService,
  options: SteelDocsSyncServerOptions,
) {
  return createApiServer(engine, service, {
    artifactStore: options.artifactStore,
    beforeRoutes: [createSteelDocsWebhookRoute(service, options)],
  });
}

function createSteelDocsWebhookRoute(
  service: MailboxService,
  options: SteelDocsSyncServerOptions,
): ApiRouteHandler {
  return async (request, response) => {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (method !== "POST" || path !== webhookPath) {
      return false;
    }

    const timestampHeader = request.headers["x-agent-mailbox-timestamp"];
    const signatureHeader = request.headers["x-agent-mailbox-signature"];
    if (typeof timestampHeader !== "string" || typeof signatureHeader !== "string") {
      writeJson(response, 401, { error: "Missing webhook authentication headers" });
      return true;
    }

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (Number.isNaN(timestamp) || Math.abs(Date.now() - timestamp) > webhookClockSkewMs) {
      writeJson(response, 403, { error: "Webhook timestamp is stale or invalid" });
      return true;
    }

    const body = await readBody(request);
    if (!hasValidSignature(body, timestampHeader, signatureHeader, options.webhookSecret)) {
      writeJson(response, 403, { error: "Webhook signature verification failed" });
      return true;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body.toString("utf8"));
    } catch {
      writeJson(response, 400, { error: "Webhook body must be valid JSON" });
      return true;
    }

    const payloadResult = SteelDocsSyncWebhookPayloadSchema.safeParse(parsedJson);
    if (!payloadResult.success) {
      writeJson(response, 400, { error: z.prettifyError(payloadResult.error) });
      return true;
    }

    const payload = payloadResult.data;
    const invalidUrl = firstInvalidUrl(payload, new Set(options.allowedHosts ?? allowedHosts));
    if (invalidUrl) {
      writeJson(response, 400, { error: `URL host is not allowed: ${invalidUrl}` });
      return true;
    }

    const session = await service.startSession({
      prompt: buildAuditPrompt(payload),
      source: "github-action",
      actor: { type: "system", id: "github-actions" },
      metadata: payload,
      idempotencyKey: `${payload.repository}:${payload.runId}:${payload.runAttempt}`,
    });
    const origin = requestOrigin(request);
    writeJson(response, 202, {
      mailboxId: session.mailboxId,
      correlationId: session.correlationId,
      statusUrl: `${origin}/mailboxes/${encodeURIComponent(session.mailboxId)}`,
      eventsUrl: `${origin}/mailboxes/${encodeURIComponent(session.mailboxId)}/events`,
    });
    return true;
  };
}

function buildAuditPrompt(payload: SteelDocsSyncWebhookPayload): string {
  return `@steel-docs audit ${payload.mode} for ${payload.repository} at ${payload.sha} from ${payload.ref} and summarize any docs drift warnings.`;
}

function firstInvalidUrl(payload: SteelDocsSyncWebhookPayload, allowed: ReadonlySet<string>): string | null {
  const urls = [
    payload.docsBaseUrl,
    payload.llmsTxtUrl,
    payload.llmsFullTxtUrl,
    payload.apiReferenceUrl,
    payload.openApiSpecUrl,
  ];

  for (const candidate of urls) {
    if (!candidate) {
      continue;
    }
    const url = new URL(candidate);
    if (!allowed.has(url.host)) {
      return candidate;
    }
  }

  return null;
}

function hasValidSignature(body: Buffer, timestamp: string, signatureHeader: string, secret: string): boolean {
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body.toString("utf8")}`).digest("hex")}`;
  const provided = Buffer.from(signatureHeader, "utf8");
  const actual = Buffer.from(expected, "utf8");
  return provided.length === actual.length && timingSafeEqual(provided, actual);
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function requestOrigin(request: IncomingMessage): string {
  const protoHeader = request.headers["x-forwarded-proto"];
  const protocol = typeof protoHeader === "string" && protoHeader.length > 0 ? protoHeader : "http";
  const host = request.headers.host ?? "localhost";
  return `${protocol}://${host}`;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
