import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createApiServer,
  type ApiRouteHandler,
  type ThreadArtifactStore,
  type ThreadEngine,
  type ThreadService,
} from "weave/server";
import {
  normalizeGitHubReviewRequestedWebhook,
  verifyGitHubWebhookSignature,
  type BladeGithubReviewIntakeOptions,
} from "./github-intake.js";

export const bladeGithubWebhookPath = "/webhooks/github/blade";

export type BladeServerOptions = BladeGithubReviewIntakeOptions & {
  webhookSecret: string;
  artifactStore?: ThreadArtifactStore;
};

export function createBladeApiServer(
  engine: ThreadEngine,
  service: ThreadService,
  options: BladeServerOptions,
) {
  return createApiServer(engine, service, {
    artifactStore: options.artifactStore,
    beforeRoutes: [createBladeGithubWebhookRoute(service, options)],
  });
}

export function createBladeGithubWebhookRoute(
  service: ThreadService,
  options: BladeServerOptions,
): ApiRouteHandler {
  return async (request, response) => {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (method !== "POST" || path !== bladeGithubWebhookPath) {
      return false;
    }

    const signature = headerString(request, "x-hub-signature-256");
    const eventName = headerString(request, "x-github-event");
    const deliveryId = headerString(request, "x-github-delivery");
    if (!signature || !eventName || !deliveryId) {
      writeJson(response, 401, { error: "Missing GitHub webhook authentication headers" });
      return true;
    }

    const body = await readBody(request);
    if (!verifyGitHubWebhookSignature(body, signature, options.webhookSecret)) {
      writeJson(response, 403, { error: "GitHub webhook signature verification failed" });
      return true;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body.toString("utf8"));
    } catch {
      writeJson(response, 400, { error: "Webhook body must be valid JSON" });
      return true;
    }

    const normalized = normalizeGitHubReviewRequestedWebhook({
      deliveryId,
      eventName,
      payload: parsedJson,
      options,
    });
    if (normalized.status === "ignored") {
      writeJson(response, 202, { ignored: true, reason: normalized.reason });
      return true;
    }
    if (normalized.status === "rejected") {
      const statusCode = normalized.reason.startsWith("Repository is not allowlisted") ? 403 : 400;
      writeJson(response, statusCode, { error: normalized.reason });
      return true;
    }

    const session = await service.startSession({
      prompt: normalized.prompt,
      source: "github-action",
      agentName: "blade.github-pr-review",
      actor: { type: "user", id: `github:${normalized.work.workItem.createdBy.login}` },
      metadata: normalized.work,
      idempotencyKey: normalized.work.workItem.idempotencyKey,
    });
    const origin = requestOrigin(request);
    writeJson(response, 202, {
      threadId: session.threadId,
      correlationId: session.correlationId,
      statusUrl: `${origin}/threads/${encodeURIComponent(session.threadId)}`,
      eventsUrl: `${origin}/threads/${encodeURIComponent(session.threadId)}/events`,
    });
    return true;
  };
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
