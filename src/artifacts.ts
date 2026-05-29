import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { z } from "zod";

export const ThreadArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  threadId: z.string().min(1),
  toolCallId: z.string().uuid().nullable(),
  kind: z.string().min(1),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
  uri: z.string().min(1),
  sourceUrl: z.string().url(),
  createdAt: z.string().datetime(),
});
export type ThreadArtifact = z.infer<typeof ThreadArtifactSchema>;

export const ThreadSnapshotSchema = z.object({
  snapshotKey: z.string().min(1),
  threadId: z.string().min(1),
  artifactId: z.string().uuid(),
  sha256: z.string().length(64),
  metadata: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().datetime(),
});
export type ThreadSnapshot = z.infer<typeof ThreadSnapshotSchema>;

export type PutThreadArtifactInput = {
  threadId: string;
  toolCallId?: string;
  kind: string;
  mediaType: string;
  sourceUrl: string;
  body: string | Uint8Array;
};

export type PutThreadSnapshotInput = {
  snapshotKey: string;
  threadId: string;
  artifactId: string;
  sha256: string;
  metadata?: Record<string, unknown>;
};

export interface ThreadArtifactStore {
  putArtifact(input: PutThreadArtifactInput): Promise<ThreadArtifact>;
  listArtifacts(threadId: string): Promise<ThreadArtifact[]>;
  getSnapshot(snapshotKey: string): Promise<ThreadSnapshot | null>;
  putSnapshot(input: PutThreadSnapshotInput): Promise<ThreadSnapshot>;
}

export class NoopThreadArtifactStore implements ThreadArtifactStore {
  async putArtifact(): Promise<ThreadArtifact> {
    throw new Error("Artifact store not configured");
  }

  async listArtifacts(): Promise<ThreadArtifact[]> {
    return [];
  }

  async getSnapshot(): Promise<ThreadSnapshot | null> {
    return null;
  }

  async putSnapshot(): Promise<ThreadSnapshot> {
    throw new Error("Artifact store not configured");
  }
}

export class PostgresThreadArtifactStore implements ThreadArtifactStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { rootDir?: string } = {},
  ) {}

  async putArtifact(input: PutThreadArtifactInput): Promise<ThreadArtifact> {
    const artifactId = randomUUID();
    const buffer = typeof input.body === "string" ? Buffer.from(input.body, "utf8") : Buffer.from(input.body);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const byteLength = buffer.byteLength;
    const filePath = join(this.options.rootDir ?? "/tmp/opencode/weave-artifacts", artifactId);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, buffer);

    const result = await this.pool.query<{
      artifact_id: string;
      thread_id: string;
      tool_call_id: string | null;
      kind: string;
      media_type: string;
      sha256: string;
      byte_length: number;
      uri: string;
      source_url: string;
      created_at: Date;
    }>(
      `insert into weave.thread_artifact(
         artifact_id,
         thread_id,
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
        input.threadId,
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

  async listArtifacts(threadId: string): Promise<ThreadArtifact[]> {
    const result = await this.pool.query<{
      artifact_id: string;
      thread_id: string;
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
       from weave.thread_artifact
       where thread_id = $1
       order by created_at asc, artifact_id asc`,
      [threadId],
    );

    return result.rows.map(artifactFromRow);
  }

  async getSnapshot(snapshotKey: string): Promise<ThreadSnapshot | null> {
    const result = await this.pool.query<{
      snapshot_key: string;
      thread_id: string;
      artifact_id: string;
      sha256: string;
      metadata_json: Record<string, unknown> | null;
      updated_at: Date;
    }>(
      `select *
       from weave.thread_snapshot
       where snapshot_key = $1`,
      [snapshotKey],
    );

    const row = result.rows[0];
    return row ? snapshotFromRow(row) : null;
  }

  async putSnapshot(input: PutThreadSnapshotInput): Promise<ThreadSnapshot> {
    const result = await this.pool.query<{
      snapshot_key: string;
      thread_id: string;
      artifact_id: string;
      sha256: string;
      metadata_json: Record<string, unknown> | null;
      updated_at: Date;
    }>(
      `insert into weave.thread_snapshot(
         snapshot_key,
         thread_id,
         artifact_id,
         sha256,
         metadata_json
       ) values ($1, $2, $3, $4, $5)
       on conflict (snapshot_key) do update
         set thread_id = excluded.thread_id,
             artifact_id = excluded.artifact_id,
             sha256 = excluded.sha256,
             metadata_json = excluded.metadata_json,
             updated_at = now()
       returning *`,
      [input.snapshotKey, input.threadId, input.artifactId, input.sha256, JSON.stringify(input.metadata ?? {})],
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
  thread_id: string;
  tool_call_id: string | null;
  kind: string;
  media_type: string;
  sha256: string;
  byte_length: number;
  uri: string;
  source_url: string;
  created_at: Date;
} | undefined): ThreadArtifact {
  if (!row) {
    throw new Error("Artifact row missing");
  }

  return ThreadArtifactSchema.parse({
    artifactId: row.artifact_id,
    threadId: row.thread_id,
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
  thread_id: string;
  artifact_id: string;
  sha256: string;
  metadata_json: Record<string, unknown> | null;
  updated_at: Date;
}): ThreadSnapshot {
  return ThreadSnapshotSchema.parse({
    snapshotKey: row.snapshot_key,
    threadId: row.thread_id,
    artifactId: row.artifact_id,
    sha256: row.sha256,
    metadata: row.metadata_json ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  });
}
