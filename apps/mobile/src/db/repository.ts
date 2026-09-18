import type { components } from "../../../../packages/api-client/schema";

export type Entity = components["schemas"]["EntityOut"];
export type EntryContent = components["schemas"]["EntryContent"];
export type KnowledgeContent = components["schemas"]["KnowledgeContent"];
export type Mutation =
  | components["schemas"]["EntryMutation"]
  | components["schemas"]["KnowledgeMutation"];
export type LocalEntity = Entity & { sync: string };
export type Outbox = {
  seq: number;
  operation_id: string;
  entity_id: string;
  kind: string;
  action: string;
  payload: string;
  status: string;
  attempt_count: number;
  next_retry_at: number;
  sealed: number;
  error: string | null;
  conflict_id: string | null;
};
export type LocalConflict = {
  id: string;
  entity_id: string;
  local_snapshot: string;
  server_snapshot: string;
};
type Value = string | number | null;
export interface SQL {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...args: Value[]): Promise<unknown>;
  getAllAsync<T>(sql: string, ...args: Value[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...args: Value[]): Promise<T | null>;
}

export class Repository {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    public db: SQL,
    private uuid: () => string,
  ) {}
  // One serialized transaction lane for UI writes, sync acknowledgements and pulls.
  transaction<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      await this.db.execAsync("BEGIN IMMEDIATE");
      try {
        const value = await work();
        await this.db.execAsync("COMMIT");
        return value;
      } catch (error) {
        await this.db.execAsync("ROLLBACK");
        throw error;
      }
    });
    this.chain = next.catch(() => {});
    return next;
  }
  async migrate() {
    await this.db.execAsync("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    await this.transaction(async () => {
      const version = await this.db.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      if ((version?.user_version ?? 0) > 1)
        throw new Error("Требуется новая версия приложения");
      if (!version?.user_version)
        await this.db.execAsync(`
        CREATE TABLE entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, snapshot TEXT NOT NULL, sync TEXT NOT NULL);
        CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT UNIQUE NOT NULL,
          entity_id TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER NOT NULL DEFAULT 0, sealed INTEGER NOT NULL DEFAULT 0, error TEXT, conflict_id TEXT);
        CREATE INDEX outbox_entity ON outbox(entity_id, seq);
        CREATE TABLE conflicts (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, local_snapshot TEXT NOT NULL, server_snapshot TEXT NOT NULL);
        CREATE TABLE history (seq INTEGER PRIMARY KEY AUTOINCREMENT, entity_id TEXT NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
      await this.db.runAsync(
        "UPDATE outbox SET status='pending' WHERE status='sending'",
      );
    });
  }
  async all(kind?: string): Promise<LocalEntity[]> {
    const rows = await this.db.getAllAsync<{ snapshot: string; sync: string }>(
      "SELECT snapshot,sync FROM entities" + (kind ? " WHERE kind=?" : ""),
      ...(kind ? [kind] : []),
    );
    return rows
      .map((r) => ({ ...JSON.parse(r.snapshot), sync: r.sync }))
      .filter((e) => !e.deleted_at)
      .sort((a, b) =>
        String(b.content.occurred_at ?? b.created_at).localeCompare(
          String(a.content.occurred_at ?? a.created_at),
        ),
      );
  }
  async get(id: string): Promise<LocalEntity | null> {
    const row = await this.db.getFirstAsync<{ snapshot: string; sync: string }>(
      "SELECT snapshot,sync FROM entities WHERE id=?",
      id,
    );
    return row ? { ...JSON.parse(row.snapshot), sync: row.sync } : null;
  }
  async put(e: Entity, sync: string) {
    await this.db.runAsync(
      "INSERT INTO entities VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot,sync=excluded.sync",
      e.id,
      e.kind,
      JSON.stringify(e),
      sync,
    );
  }
  async save(
    kind: string,
    content: EntryContent | KnowledgeContent,
    id = this.uuid(),
    deleted = false,
    expectedRevision?: number,
  ) {
    await this.transaction(async () => {
      const previous = await this.get(id);
      // A rejected request was never applied. A user correction supersedes its
      // dependent edits, preserving their snapshots in the local history.
      const rejected = await this.db.getFirstAsync<Outbox>(
        "SELECT * FROM outbox WHERE entity_id=? AND status='blocked' ORDER BY seq LIMIT 1",
        id,
      );
      if (rejected)
        await this.db.runAsync(
          "UPDATE outbox SET status='superseded' WHERE entity_id=? AND status NOT IN ('completed','superseded')",
          id,
        );
      const timestamp = new Date().toISOString();
      const entity: Entity = {
        id,
        kind,
        content,
        revision: previous?.revision ?? 0,
        source: "user",
        created_at: previous?.created_at ?? timestamp,
        updated_at: timestamp,
        deleted_at: deleted ? timestamp : null,
      };
      const payload = {
        operation_id: this.uuid(),
        id,
        base_revision: expectedRevision ?? entity.revision,
        content,
        deleted,
      };
      await this.put(
        entity,
        previous?.sync === "conflict" ? "conflict" : "pending",
      );
      await this.db.runAsync(
        "INSERT INTO history(entity_id,snapshot) VALUES (?,?)",
        id,
        JSON.stringify(entity),
      );
      await this.db.runAsync(
        "INSERT INTO outbox(operation_id,entity_id,kind,action,payload) VALUES (?,?,?,?,?)",
        payload.operation_id,
        id,
        kind,
        rejected?.action === "create" || !previous
          ? "create"
          : deleted
            ? "delete"
            : "save",
        JSON.stringify(payload),
      );
    });
    return id;
  }
  async queue() {
    return this.db.getAllAsync<Outbox>(
      "SELECT * FROM outbox WHERE status NOT IN ('completed','superseded') ORDER BY seq",
    );
  }
  async seal(op: Outbox) {
    return this.transaction(async () => {
      const current = await this.db.getFirstAsync<Outbox>(
        "SELECT * FROM outbox WHERE seq=?",
        op.seq,
      );
      if (!current || !["pending", "failed_retryable"].includes(current.status))
        return null;
      await this.db.runAsync(
        "UPDATE outbox SET sealed=1,status='sending' WHERE seq=?",
        op.seq,
      );
      return JSON.parse(current.payload) as Mutation;
    });
  }
  async acknowledge(op: Outbox, server: Entity) {
    await this.transaction(async () => {
      const current = await this.db.getFirstAsync<Outbox>(
        "SELECT * FROM outbox WHERE seq=?",
        op.seq,
      );
      if (!current || current.status === "superseded") return;
      await this.db.runAsync(
        "UPDATE outbox SET status='completed' WHERE seq=?",
        op.seq,
      );
      const remaining = await this.db.getAllAsync<Outbox>(
        "SELECT * FROM outbox WHERE entity_id=? AND status NOT IN ('completed','superseded') ORDER BY seq",
        op.entity_id,
      );
      // The next operation's base is assigned once, before its first send. Never mutate an attempted request.
      if (remaining[0] && !remaining[0].sealed) {
        const payload = JSON.parse(remaining[0].payload);
        payload.base_revision = server.revision;
        await this.db.runAsync(
          "UPDATE outbox SET payload=? WHERE seq=?",
          JSON.stringify(payload),
          remaining[0].seq,
        );
      }
      const latest = await this.get(op.entity_id);
      await this.put(
        remaining.length && latest
          ? { ...latest, revision: server.revision }
          : server,
        remaining.length ? "pending" : "synced",
      );
      if (op.conflict_id)
        await this.db.runAsync(
          "DELETE FROM conflicts WHERE entity_id=?",
          op.entity_id,
        );
    });
  }
  async fail(op: Outbox, status: string, message: string, next = 0) {
    await this.transaction(async () => {
      const current = await this.db.getFirstAsync<Outbox>(
        "SELECT * FROM outbox WHERE seq=?",
        op.seq,
      );
      if (!current || current.status === "superseded") return;
      await this.db.runAsync(
        "UPDATE outbox SET status=?,error=?,attempt_count=attempt_count+1,next_retry_at=? WHERE seq=?",
        status,
        message,
        next,
        op.seq,
      );
      await this.db.runAsync(
        "UPDATE entities SET sync=? WHERE id=?",
        status,
        op.entity_id,
      );
    });
  }
  async conflict(
    op: Outbox,
    result: { conflict_id: string; server_snapshot: Entity },
  ) {
    await this.transaction(async () => {
      const local = await this.get(op.entity_id);
      const current = await this.db.getFirstAsync<Outbox>(
        "SELECT * FROM outbox WHERE seq=?",
        op.seq,
      );
      if (!current || current.status === "superseded") return;
      await this.db.runAsync(
        "INSERT OR REPLACE INTO conflicts VALUES (?,?,?,?)",
        result.conflict_id,
        op.entity_id,
        JSON.stringify(local),
        JSON.stringify(result.server_snapshot),
      );
      await this.db.runAsync(
        "UPDATE outbox SET status='conflict' WHERE seq=?",
        op.seq,
      );
      await this.db.runAsync(
        "UPDATE entities SET sync='conflict' WHERE id=?",
        op.entity_id,
      );
    });
  }
  async conflicts() {
    return this.db.getAllAsync<LocalConflict>(
      "SELECT * FROM conflicts c WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.conflict_id=c.id AND o.status NOT IN ('completed','superseded','conflict','blocked'))",
    );
  }
  async resolve(
    conflict: LocalConflict,
    content: EntryContent | KnowledgeContent,
    deleted: boolean,
  ) {
    await this.transaction(async () => {
      const server: Entity = JSON.parse(conflict.server_snapshot);
      const { ai: _ai, ...editable } = content as Record<string, unknown>;
      const local = await this.get(conflict.entity_id);
      if (!local) throw new Error("Запись не найдена");
      const payload = {
        operation_id: this.uuid(),
        id: local.id,
        base_revision: server.revision,
        content: editable,
        deleted,
      };
      // Superseded operations remain in history. User explicitly chooses the complete current local version.
      await this.db.runAsync(
        "UPDATE outbox SET status='superseded' WHERE entity_id=? AND status!='completed'",
        local.id,
      );
      await this.db.runAsync(
        "INSERT INTO outbox(operation_id,entity_id,kind,action,payload,conflict_id) VALUES (?,?,?,?,?,?)",
        payload.operation_id,
        local.id,
        local.kind,
        "resolve",
        JSON.stringify(payload),
        conflict.id,
      );
      await this.put(
        {
          ...local,
          content,
          deleted_at: deleted ? new Date().toISOString() : null,
        },
        "pending",
      );
    });
  }
  async receive(server: Entity) {
    await this.transaction(async () => {
      const pending = await this.db.getFirstAsync(
        "SELECT seq FROM outbox WHERE entity_id=? AND status NOT IN ('completed','superseded') LIMIT 1",
        server.id,
      );
      if (!pending) await this.put(server, "synced");
    });
  }
  async history(id: string) {
    return (
      await this.db.getAllAsync<{ snapshot: string }>(
        "SELECT snapshot FROM history WHERE entity_id=? ORDER BY seq DESC",
        id,
      )
    ).map((r) => JSON.parse(r.snapshot) as Entity);
  }
  async export() {
    return {
      entities: await this.db.getAllAsync("SELECT * FROM entities"),
      history: await this.db.getAllAsync("SELECT * FROM history"),
      outbox: await this.queue(),
      conflicts: await this.conflicts(),
    };
  }
  async bindOwner(userId: string) {
    await this.transaction(async () => {
      const owner = await this.db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='owner'",
      );
      if (owner && owner.value !== userId)
        throw new Error(
          "Сначала выйдите из предыдущего аккаунта и очистите локальные данные.",
        );
      await this.db.runAsync(
        "INSERT OR REPLACE INTO meta VALUES ('owner',?)",
        userId,
      );
    });
  }
  async clear() {
    await this.transaction(async () => {
      await this.db.execAsync(
        "DELETE FROM outbox; DELETE FROM conflicts; DELETE FROM history; DELETE FROM entities; DELETE FROM meta;",
      );
    });
  }
}
