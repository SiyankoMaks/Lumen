import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  Repository,
  type SQL,
  type Entity,
  type Mutation,
} from "../src/db/repository";
import { SyncEngine, ApiError, type Transport } from "../src/sync/engine";
import { parseDate } from "../src/shared/dates";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  const sql: SQL = {
    async execAsync(s) {
      db.exec(s);
    },
    async runAsync(s, ...args) {
      return db.prepare(s).run(...args);
    },
    async getAllAsync<T>(s: string, ...args: any[]) {
      return db.prepare(s).all(...args) as T[];
    },
    async getFirstAsync<T>(s: string, ...args: any[]) {
      return (db.prepare(s).get(...args) ?? null) as T | null;
    },
  };
  const repo = new Repository(sql, randomUUID);
  await repo.migrate();
  return { repo, db };
}
const content = (text: string) => ({
  text,
  type: "note" as const,
  occurred_at: "2026-09-16T10:00:00.000Z",
  tags: [],
  metadata: {},
});
class Server implements Transport {
  rows = new Map<string, Entity>();
  operations = new Map<string, Entity>();
  calls: Mutation[] = [];
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    if (method === "GET")
      return (path.startsWith("/entries") ? [...this.rows.values()] : []) as T;
    const p = body as Mutation;
    this.calls.push(structuredClone(p));
    const prior = this.operations.get(p.operation_id);
    if (prior) return structuredClone(prior) as T;
    const current = this.rows.get(p.id);
    if (current && p.base_revision !== current.revision)
      throw new ApiError(409, {
        conflict_id: randomUUID(),
        server_snapshot: current,
      });
    const entity: Entity = {
      id: p.id,
      kind: "entry",
      content: p.content,
      revision: (current?.revision ?? 0) + 1,
      source: "user",
      created_at: "2026-09-16T10:00:00Z",
      updated_at: "2026-09-16T10:00:00Z",
      deleted_at: p.deleted ? "2026-09-16T10:00:00Z" : null,
    };
    this.rows.set(p.id, entity);
    this.operations.set(p.operation_id, entity);
    return structuredClone(entity) as T;
  }
}

test("offline create/edit/delete preserve causal revisions across restart", async () => {
  const { repo, db } = await fixture();
  const id = await repo.save("entry", content("one"));
  await repo.save("entry", content("two"), id);
  await repo.save("entry", content("two"), id, true);
  await repo.migrate();
  assert.equal((await repo.queue()).length, 3);
  const server = new Server();
  await new SyncEngine(repo, server).run();
  assert.deepEqual(
    server.calls.map((c) => c.base_revision),
    [0, 1, 2],
  );
  assert.equal(server.rows.get(id)?.revision, 3);
  assert.ok(server.rows.get(id)?.deleted_at);
  assert.equal((await repo.queue()).length, 0);
  assert.equal((await repo.all()).length, 0);
  db.close();
});

test("lost response retries identical operation without duplicate; independent entity continues", async () => {
  const { repo, db } = await fixture();
  const first = await repo.save("entry", content("one"));
  await repo.save("entry", content("two"), first);
  const independent = await repo.save("entry", content("other"));
  const server = new Server();
  let lost = true;
  const api: Transport = {
    async request<T>(path: string, method?: string, body?: unknown) {
      const value = await server.request<T>(path, method, body);
      if (method !== "GET" && (body as Mutation)?.id === first && lost) {
        lost = false;
        throw new Error("lost response");
      }
      return value;
    },
  };
  let now = 100;
  const engine = new SyncEngine(
    repo,
    api,
    () => {},
    () => 0.5,
    () => now,
  );
  await engine.run();
  assert.equal(server.rows.get(independent)?.revision, 1);
  assert.equal(server.rows.get(first)?.revision, 1);
  now = 1000000;
  await engine.run();
  assert.equal(server.rows.get(first)?.revision, 2);
  const attempts = server.calls.filter((c) => c.id === first);
  assert.deepEqual(attempts[0], attempts[1]);
  db.close();
});

test("edit while request in flight is preserved after acknowledgement", async () => {
  const { repo, db } = await fixture();
  const id = await repo.save("entry", content("one"));
  const server = new Server();
  let first = true;
  const api: Transport = {
    async request<T>(path: string, method?: string, body?: unknown) {
      if (method === "POST" && first) {
        first = false;
        await repo.save("entry", content("edited during sync"), id);
      }
      return server.request<T>(path, method, body);
    },
  };
  const engine = new SyncEngine(repo, api);
  await engine.run();
  assert.equal((await repo.get(id))?.content.text, "edited during sync");
  await engine.run();
  assert.equal(server.rows.get(id)?.content.text, "edited during sync");
  assert.equal(server.rows.get(id)?.revision, 2);
  db.close();
});

test("conflict retains both versions, blocks entity and explicit merge creates revision", async () => {
  const { repo, db } = await fixture();
  const id = await repo.save("entry", content("original"));
  const server = new Server();
  const engine = new SyncEngine(repo, server);
  await engine.run();
  await repo.save("entry", content("local"), id);
  await repo.save("entry", content("later local"), id);
  server.rows.set(id, {
    ...server.rows.get(id)!,
    revision: 2,
    content: content("cloud"),
  });
  await engine.run();
  const conflicts = await repo.conflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(JSON.parse(conflicts[0].server_snapshot).content.text, "cloud");
  assert.equal((await repo.get(id))?.content.text, "later local");
  await repo.resolve(conflicts[0], content("merged"), false);
  await engine.run();
  assert.equal(server.rows.get(id)?.revision, 3);
  assert.equal(server.rows.get(id)?.content.text, "merged");
  assert.equal((await repo.conflicts()).length, 0);
  assert.equal((await repo.queue()).length, 0);
  db.close();
});

test("migration preserves pending writes and transaction rolls back failed outbox", async () => {
  const { repo, db } = await fixture();
  await repo.save("entry", content("keep"));
  await repo.migrate();
  assert.equal((await repo.queue()).length, 1);
  db.exec(
    "CREATE TRIGGER reject_write BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'disk full'); END;",
  );
  await assert.rejects(() => repo.save("entry", content("must rollback")));
  assert.equal((await repo.all()).length, 1);
  db.close();
});

test("editor keeps observed revision when cloud changes while typing", async () => {
  const { repo, db } = await fixture();
  const id = await repo.save("entry", content("original"));
  const server = new Server();
  const engine = new SyncEngine(repo, server);
  await engine.run();
  server.rows.set(id, {
    ...server.rows.get(id)!,
    revision: 2,
    content: content("cloud while typing"),
  });
  await engine.run();
  await repo.save("entry", content("draft based on version 1"), id, false, 1);
  await engine.run();
  assert.equal((await repo.conflicts()).length, 1);
  assert.equal(server.rows.get(id)?.content.text, "cloud while typing");
  db.close();
});

test("owner binding prevents mixing accounts", async () => {
  const { repo, db } = await fixture();
  await repo.bindOwner("first");
  await assert.rejects(() => repo.bindOwner("second"));
  await repo.bindOwner("first");
  await repo.clear();
  await repo.bindOwner("second");
  db.close();
});

test("invalid calendar dates are rejected", () => {
  assert.throws(() => parseDate("31.02.2026 10:00"));
  assert.equal(parseDate("16.09.2026 09:45").getMinutes(), 45);
});
