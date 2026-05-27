import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { z } from "zod";

export const MailboxArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  mailboxId: z.string().min(1),
  toolCallId: z.string().uuid().nullable(),
  kind: z.string().min(1),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
  uri: z.string().min(1),
  sourceUrl: z.string().url(),
  createdAt: z.string().datetime(),
});
export type MailboxArtifact = z.infer<typeof MailboxArtifactSchema>;

export const MailboxSnapshotSchema = z.object({
  snapshotKey: z.string().min(1),
  mailboxId: z.string().min(1),
  artifactId: z.string().uuid(),
  sha256: z.string().length(64),
  metadata: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});
export type MailboxSnapshot = z.infer<typeof MailboxSnapshotSchema>;

export type PutMailboxArtifactInput = {
  mailboxId: string;
  toolCallId?: string;
  kind: string;
  mediaType: string;
  sourceUrl: string;
  body: string | Uint8Array;
};

export type PutMailboxSnapshotInput = {
  snapshotKey: string;
  mailboxId: string;
  artifactId: string;
  sha256: string;
  metadata?: Record<string, unknown>;
};

export interface MailboxArtifactStore {
  putArtifact(input: PutMailboxArtifactInput): Promise<MailboxArtifact>;
  listArtifacts(mailboxId: string): Promise<MailboxArtifact[]>;
  getSnapshot(snapshotKey: string): Promise<MailboxSnapshot | null>;
  putSnapshot(input: PutMailboxSnapshotInput): Promise<MailboxSnapshot>;
}

export class NoopMailboxArtifactStore implements MailboxArtifactStore {
  async putArtifact(): Promise<MailboxArtifact> {
    throw new Error("Artifact store not configured");
  }

  async listArtifacts(): Promise<MailboxArtifact[]> {
    return [];
  }

  async getSnapshot(): Promise<MailboxSnapshot | null> {
    return null;
  }

  async putSnapshot(): Promise<MailboxSnapshot> {
    throw new Error("Artifact store not configured");
  }
}

export class PostgresMailboxArtifactStore implements MailboxArtifactStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { rootDir?: string } = {},
  ) {}

  async putArtifact(input: PutMailboxArtifactInput): Promise<MailboxArtifact> {
    const artifactId = randomUUID();
    const buffer = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const byteLength = buffer.byteLength;
    const filePath = join(this.options.rootDir ?? "/tmp/opencode/agent-mailbox-artifacts", artifactId);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, buffer);

    const result = await this.pool.query<{
      artifact_id: string;
      mailbox_id: string;
      tool_call_id: string | null;
      kind: string;
      media_type: string;
      sha256: string;
      byte_length: number;
      uri: string;
      source_url: string;
      created_at: Date;
    }>(
      `insert into agent_mailbox.mailbox_artifact(
         artifact_id,
         mailbox_id,
         tool_call_id,
         kind,
         media_type,
         sha256,
         byte_length,
         uri,
         source_url
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        artifactId,
        input.mailboxId,
        input.toolCallId ?? null,
        input.kind,
        input.mediaType,
        sha256,
        byteLength,
        pathToFileURL(filePath).toString(),
        input.sourceUrl,
      ],
    );

    return artifactFromRow(result.rows[0]);
  }

  async listArtifacts(mailboxId: string): Promise<MailboxArtifact[]> {
    const result = await this.pool.query<{
      artifact_id: string;
      mailbox_id: string;
      tool_call_id: string | null;
      kind: string;
      media_type: string;
      sha256: string;
      byte_length: number;
      uri: string;
      source_url: string;
      created_at: Date;
    }>(
      `select *
       from agent_mailbox.mailbox_artifact
       where mailbox_id = $1
       order by created_at asc, artifact_id asc`,
      [mailboxId],
    );

    return result.rows.map(artifactFromRow);
  }

  async getSnapshot(snapshotKey: string): Promise<MailboxSnapshot | null> {
    const result = await this.pool.query<{
      snapshot_key: string;
      mailbox_id: string;
      artifact_id: string;
      sha256: string;
      metadata_json: Record<string, unknown> | null;
      updated_at: Date;
    }>(
      `select *
       from agent_mailbox.mailbox_snapshot
       where snapshot_key = $1`,
      [snapshotKey],
    );

    const row = result.rows[0];
    return row ? snapshotFromRow(row) : null;
  }

  async putSnapshot(input: PutMailboxSnapshotInput): Promise<MailboxSnapshot> {
    const result = await this.pool.query<{
      snapshot_key: string;
      mailbox_id: string;
      artifact_id: string;
      sha256: string;
      metadata_json: Record<string, unknown> | null;
      updated_at: Date;
    }>(
      `insert into agent_mailbox.mailbox_snapshot(
         snapshot_key,
         mailbox_id,
         artifact_id,
         sha256,
         metadata_json
       ) values ($1, $2, $3, $4, $5)
       on conflict (snapshot_key) do update
         set mailbox_id = excluded.mailbox_id,
             artifact_id = excluded.artifact_id,
             sha256 = excluded.sha256,
             metadata_json = excluded.metadata_json,
             updated_at = now()
       returning *`,
      [input.snapshotKey, input.mailboxId, input.artifactId, input.sha256, JSON.stringify(input.metadata ?? {})],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(`Snapshot write failed for ${input.snapshotKey}`);
    }

    return snapshotFromRow(row);
  }
}

function artifactFromRow(row: {
  artifact_id: string;
  mailbox_id: string;
  tool_call_id: string | null;
  kind: string;
  media_type: string;
  sha256: string;
  byte_length: number;
  uri: string;
  source_url: string;
  created_at: Date;
} | undefined): MailboxArtifact {
  if (!row) {
    throw new Error("Artifact row missing");
  }

  return MailboxArtifactSchema.parse({
    artifactId: row.artifact_id,
    mailboxId: row.mailbox_id,
    toolCallId: row.tool_call_id,
    kind: row.kind,
    mediaType: row.media_type,
    sha256: row.sha256,
    byteLength: row.byte_length,
    uri: row.uri,
    sourceUrl: row.source_url,
    createdAt: row.created_at.toISOString(),
  });
}

function snapshotFromRow(row: {
  snapshot_key: string;
  mailbox_id: string;
  artifact_id: string;
  sha256: string;
  metadata_json: Record<string, unknown> | null;
  updated_at: Date;
}): MailboxSnapshot {
  return MailboxSnapshotSchema.parse({
    snapshotKey: row.snapshot_key,
    mailboxId: row.mailbox_id,
    artifactId: row.artifact_id,
    sha256: row.sha256,
    metadata: row.metadata_json ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  });
}
