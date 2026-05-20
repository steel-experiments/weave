import type { MailboxEvent, MailboxProjection } from "./events.js";

export type AppendOptions = {
  expectedTailSeq?: number;
  idempotencyKey?: string;
};

export type AppendResult = {
  firstSeq: number;
  lastSeq: number;
};

export type ReadOptions = {
  fromSeq?: number;
  limit?: number;
};

export type FollowCursor = {
  fromSeq?: number;
  tail?: boolean;
};

export type Lease = {
  mailboxId: string;
  ownerId: string;
  token: string;
  expiresAt: string;
};

export interface MailboxEngine {
  createMailbox(mailboxId: string): Promise<void>;
  append(events: MailboxEvent[], options?: AppendOptions): Promise<AppendResult>;
  read(mailboxId: string, options?: ReadOptions): Promise<MailboxEvent[]>;
  follow(mailboxId: string, cursor?: FollowCursor): AsyncIterable<MailboxEvent>;
  getTail(mailboxId: string): Promise<{ tailSeq: number; updatedAt: string }>;
  getProjection(mailboxId: string): Promise<MailboxProjection | null>;
}

export interface MailboxLeaseStore {
  acquireLease(mailboxId: string, ownerId: string, ttlMs: number): Promise<Lease | null>;
  renewLease(mailboxId: string, token: string, ttlMs: number): Promise<Lease>;
  releaseLease(mailboxId: string, token: string): Promise<void>;
}
