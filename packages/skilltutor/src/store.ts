import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import type { Channel, ChannelLink, ChatMessage, JoinRequest, LinkCode, OutboxItem, QuizSet, TutorCertificate, TutorEvent, TutorState } from "./types";

export interface SkillTutorStore {
  getState(userId: string): Promise<TutorState | null>;
  putState(state: TutorState): Promise<void>;
  listStates(): Promise<TutorState[]>;
  appendMessage(message: ChatMessage): Promise<void>;
  /** Newest `limit` messages, oldest first; with `channels`, only that conversation thread (see threadChannels). */
  listMessages(userId: string, limit?: number, channels?: Channel[]): Promise<ChatMessage[]>;
  /** Atomically adds 1 to a per-user daily counter and returns the new value. */
  incrementUsage(userId: string, bucket: string, expiresAt: Date, delta?: number): Promise<number>;
  getUsage(userId: string, bucket: string): Promise<number>;
  addEvent(event: TutorEvent): Promise<void>;
  listEvents(limit?: number): Promise<TutorEvent[]>;
  putCertificate(cert: TutorCertificate): Promise<void>;
  getCertificate(code: string): Promise<TutorCertificate | null>;
  listCertificatesByUser(userId: string): Promise<TutorCertificate[]>;
  putLink(link: ChannelLink): Promise<void>;
  getLinkByPhone(phone: string): Promise<ChannelLink | null>;
  getLinkByUser(userId: string): Promise<ChannelLink | null>;
  deleteLink(userId: string): Promise<void>;
  putLinkCode(code: LinkCode): Promise<void>;
  /** Atomically consumes a link code; returns null when unknown or already used. */
  takeLinkCode(code: string): Promise<LinkCode | null>;
  getQuizSet(courseVersionId: string): Promise<QuizSet | null>;
  putQuizSet(set: QuizSet): Promise<void>;
  pushOutbox(item: OutboxItem): Promise<void>;
  listOutbox(limit?: number): Promise<OutboxItem[]>;
  putJoinRequest(request: JoinRequest): Promise<void>;
  getJoinRequest(expertId: string, cohortId: string, userId: string): Promise<JoinRequest | null>;
  listJoinRequests(expertId: string): Promise<JoinRequest[]>;
}

export const newId = () => randomUUID().slice(0, 8);
const clone = <T>(v: T): T => structuredClone(v);

export class InMemorySkillTutorStore implements SkillTutorStore {
  readonly states = new Map<string, TutorState>();
  readonly messages: ChatMessage[] = [];
  readonly events: TutorEvent[] = [];
  readonly certificates = new Map<string, TutorCertificate>();
  readonly links = new Map<string, ChannelLink>();
  readonly linkCodes = new Map<string, LinkCode>();
  readonly quizSets = new Map<string, QuizSet>();
  readonly outbox: OutboxItem[] = [];
  readonly joinRequests = new Map<string, JoinRequest>();

  async getState(userId: string) { const s = this.states.get(userId); return s ? clone(s) : null; }
  async putState(state: TutorState) { this.states.set(state.userId, clone(state)); }
  async listStates() { return [...this.states.values()].map(clone); }
  async appendMessage(message: ChatMessage) { this.messages.push(clone(message)); }
  readonly usage = new Map<string, number>();
  async listMessages(userId: string, limit = 50, channels?: Channel[]) {
    return this.messages.filter((m) => m.userId === userId && (!channels || channels.includes(m.channel))).slice(-limit).map(clone);
  }
  async incrementUsage(userId: string, bucket: string, _expiresAt?: Date, delta = 1) {
    const n = (this.usage.get(`${userId}#${bucket}`) ?? 0) + delta;
    this.usage.set(`${userId}#${bucket}`, n);
    return n;
  }
  async getUsage(userId: string, bucket: string) { return this.usage.get(`${userId}#${bucket}`) ?? 0; }
  async addEvent(event: TutorEvent) { this.events.push(clone(event)); }
  async listEvents(limit = 500) { return this.events.slice(-limit).reverse().map(clone); }
  async putCertificate(cert: TutorCertificate) { this.certificates.set(cert.code, clone(cert)); }
  async getCertificate(code: string) { const c = this.certificates.get(code); return c ? clone(c) : null; }
  async listCertificatesByUser(userId: string) { return [...this.certificates.values()].filter((c) => c.userId === userId).map(clone); }
  async putLink(link: ChannelLink) {
    for (const [phone, l] of this.links) if (l.userId === link.userId) this.links.delete(phone);
    this.links.set(link.phone, clone(link));
  }
  async getLinkByPhone(phone: string) { const l = this.links.get(phone); return l ? clone(l) : null; }
  async getLinkByUser(userId: string) { const l = [...this.links.values()].find((x) => x.userId === userId); return l ? clone(l) : null; }
  async deleteLink(userId: string) { for (const [phone, l] of this.links) if (l.userId === userId) this.links.delete(phone); }
  async putLinkCode(code: LinkCode) { this.linkCodes.set(code.code, clone(code)); }
  async takeLinkCode(code: string) { const c = this.linkCodes.get(code); this.linkCodes.delete(code); return c ? clone(c) : null; }
  async getQuizSet(id: string) { const q = this.quizSets.get(id); return q ? clone(q) : null; }
  async putQuizSet(set: QuizSet) { this.quizSets.set(set.courseVersionId, clone(set)); }
  async pushOutbox(item: OutboxItem) { this.outbox.push(clone(item)); }
  async listOutbox(limit = 200) { return this.outbox.slice(-limit).map(clone); }
  async putJoinRequest(r: JoinRequest) { this.joinRequests.set(`${r.expertId}#${r.cohortId}#${r.userId}`, clone(r)); }
  async getJoinRequest(expertId: string, cohortId: string, userId: string) { const r = this.joinRequests.get(`${expertId}#${cohortId}#${userId}`); return r ? clone(r) : null; }
  async listJoinRequests(expertId: string) { return [...this.joinRequests.values()].filter((r) => r.expertId === expertId).map(clone); }
}

/**
 * Dedicated single table (DYNAMODB_SKILLTUTOR_TABLE, keys pk/sk, TTL attribute `ttl`):
 *   USER#<id>        TUTOR#STATE | TUTOR#MSG#<iso> | TUTOR#CERT#<code> | TUTOR#LINK
 *   TUTOR#USERS      <userId>                       learner index for rescue scans
 *   PHONE#<e164>     LINK
 *   LINKCODE#<code>  META (ttl)
 *   CERT#<code>      META
 *   QUIZ#<cvId>      META
 *   TUTOR#EVENTS     <iso>#<id>
 *   TUTOR#OUTBOX     <iso>#<id>
 */
export class DynamoDbSkillTutorStore implements SkillTutorStore {
  private readonly doc: DynamoDBDocumentClient;
  constructor(private readonly config: { region: string; tableName: string }, client?: DynamoDBDocumentClient) {
    this.doc = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }), { marshallOptions: { removeUndefinedValues: true } });
  }
  private put(pk: string, sk: string, data: unknown, extra: Record<string, unknown> = {}) {
    return this.doc.send(new PutCommand({ TableName: this.config.tableName, Item: { pk, sk, data, ...extra } }));
  }
  private async get<T>(pk: string, sk: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.config.tableName, Key: { pk, sk }, ConsistentRead: true }));
    return (r.Item?.data as T | undefined) ?? null;
  }
  private async query<T>(pk: string, prefix?: string, limit?: number, newestFirst = false) {
    const out: T[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: prefix ? "pk = :pk AND begins_with(sk, :sk)" : "pk = :pk",
        ExpressionAttributeValues: prefix ? { ":pk": pk, ":sk": prefix } : { ":pk": pk },
        ScanIndexForward: !newestFirst,
        Limit: limit,
        ExclusiveStartKey: cursor,
      }));
      out.push(...(r.Items ?? []).map((i) => i.data as T));
      cursor = limit ? undefined : r.LastEvaluatedKey;
    } while (cursor);
    return out;
  }

  getState(userId: string) { return this.get<TutorState>(`USER#${userId}`, "TUTOR#STATE"); }
  async putState(s: TutorState) { await this.put(`USER#${s.userId}`, "TUTOR#STATE", s); await this.put("TUTOR#USERS", s.userId, s); }
  listStates() { return this.query<TutorState>("TUTOR#USERS"); }
  async appendMessage(m: ChatMessage) { await this.put(`USER#${m.userId}`, `TUTOR#MSG#${m.at}#${newId()}`, m); }
  async listMessages(userId: string, limit = 50, channels?: Channel[]) {
    if (!channels) return (await this.query<ChatMessage>(`USER#${userId}`, "TUTOR#MSG#", limit, true)).reverse();
    // One thread only: page newest-first and keep matching channels (bounded scan, no schema change).
    const out: ChatMessage[] = [];
    let cursor: Record<string, unknown> | undefined;
    let scanned = 0;
    do {
      const r = await this.doc.send(new QueryCommand({
        TableName: this.config.tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
        ExpressionAttributeValues: { ":pk": `USER#${userId}`, ":sk": "TUTOR#MSG#" },
        ScanIndexForward: false, Limit: 100, ExclusiveStartKey: cursor,
      }));
      for (const item of r.Items ?? []) {
        const m = item.data as ChatMessage;
        if (channels.includes(m.channel)) out.push(m);
        if (out.length >= limit) break;
      }
      scanned += r.Items?.length ?? 0;
      cursor = r.LastEvaluatedKey;
    } while (cursor && out.length < limit && scanned < 2000);
    return out.reverse();
  }
  async incrementUsage(userId: string, bucket: string, expiresAt: Date, delta = 1) {
    const r = await this.doc.send(new UpdateCommand({
      TableName: this.config.tableName,
      Key: { pk: `USER#${userId}`, sk: `TUTOR#USAGE#${bucket}` },
      UpdateExpression: "ADD #n :one SET #ttl = :ttl",
      ExpressionAttributeNames: { "#n": "count", "#ttl": "ttl" },
      ExpressionAttributeValues: { ":one": delta, ":ttl": Math.floor(expiresAt.getTime() / 1000) },
      ReturnValues: "UPDATED_NEW",
    }));
    return Number(r.Attributes?.count ?? 1);
  }
  async getUsage(userId: string, bucket: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.config.tableName, Key: { pk: `USER#${userId}`, sk: `TUTOR#USAGE#${bucket}` }, ConsistentRead: true }));
    return Number(r.Item?.count ?? 0);
  }
  async addEvent(e: TutorEvent) { await this.put("TUTOR#EVENTS", `${e.at}#${e.id}`, e); }
  listEvents(limit = 500) { return this.query<TutorEvent>("TUTOR#EVENTS", undefined, limit, true); }
  async putCertificate(c: TutorCertificate) { await this.put(`CERT#${c.code}`, "META", c); await this.put(`USER#${c.userId}`, `TUTOR#CERT#${c.code}`, c); }
  getCertificate(code: string) { return this.get<TutorCertificate>(`CERT#${code}`, "META"); }
  listCertificatesByUser(userId: string) { return this.query<TutorCertificate>(`USER#${userId}`, "TUTOR#CERT#"); }
  async putLink(link: ChannelLink) {
    const previous = await this.getLinkByUser(link.userId);
    if (previous && previous.phone !== link.phone) await this.doc.send(new DeleteCommand({ TableName: this.config.tableName, Key: { pk: `PHONE#${previous.phone}`, sk: "LINK" } }));
    await this.put(`PHONE#${link.phone}`, "LINK", link);
    await this.put(`USER#${link.userId}`, "TUTOR#LINK", link);
  }
  getLinkByPhone(phone: string) { return this.get<ChannelLink>(`PHONE#${phone}`, "LINK"); }
  getLinkByUser(userId: string) { return this.get<ChannelLink>(`USER#${userId}`, "TUTOR#LINK"); }
  async deleteLink(userId: string) {
    const link = await this.getLinkByUser(userId);
    if (!link) return;
    await this.doc.send(new DeleteCommand({ TableName: this.config.tableName, Key: { pk: `PHONE#${link.phone}`, sk: "LINK" } }));
    await this.doc.send(new DeleteCommand({ TableName: this.config.tableName, Key: { pk: `USER#${userId}`, sk: "TUTOR#LINK" } }));
  }
  async putLinkCode(c: LinkCode) { await this.put(`LINKCODE#${c.code}`, "META", c, { ttl: Math.floor(new Date(c.expiresAt).getTime() / 1000) }); }
  async takeLinkCode(code: string) {
    const r = await this.doc.send(new DeleteCommand({ TableName: this.config.tableName, Key: { pk: `LINKCODE#${code}`, sk: "META" }, ReturnValues: "ALL_OLD" }));
    return (r.Attributes?.data as LinkCode | undefined) ?? null;
  }
  getQuizSet(id: string) { return this.get<QuizSet>(`QUIZ#${id}`, "META"); }
  async putQuizSet(set: QuizSet) { await this.put(`QUIZ#${set.courseVersionId}`, "META", set); }
  async pushOutbox(item: OutboxItem) { await this.put("TUTOR#OUTBOX", `${item.at}#${item.id}`, item); }
  async listOutbox(limit = 200) { return (await this.query<OutboxItem>("TUTOR#OUTBOX", undefined, limit, true)).reverse(); }
  async putJoinRequest(r: JoinRequest) { await this.put(`EXPERT#${r.expertId}#JOINREQ`, `${r.cohortId}#${r.userId}`, r); }
  getJoinRequest(expertId: string, cohortId: string, userId: string) { return this.get<JoinRequest>(`EXPERT#${expertId}#JOINREQ`, `${cohortId}#${userId}`); }
  listJoinRequests(expertId: string) { return this.query<JoinRequest>(`EXPERT#${expertId}#JOINREQ`); }
}
