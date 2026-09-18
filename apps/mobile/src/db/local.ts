import {
  Repository,
  type Entity,
  type EntryContent,
  type KnowledgeContent,
  type LocalConflict,
  type SQL,
} from "./repository";
import {
  backupSchema,
  contentFor,
  kindSchema,
  knowledgeSchema,
  type Kind,
  type AIKind,
} from "../domain/local";
export type AIJob = {
  id: string;
  kind: AIKind;
  status: string;
  sources: string;
  context: string;
  model: string;
  created_at: string;
  updated_at: string;
  error: string | null;
  result_ids: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_rub: number | null;
  billing_unknown: number;
};
export class LocalRepository extends Repository {
  constructor(
    db: SQL,
    private makeId: () => string,
  ) {
    super(db, makeId);
  }
  async migrate() {
    await super.migrate(2);
    await this.transaction(async () => {
      const version = await this.db.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      if (version?.user_version === 1) {
        await this.db
          .execAsync(`CREATE TABLE local_revisions(entity_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(entity_id,revision));
     CREATE TABLE ai_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,sources TEXT NOT NULL,context TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT,result_ids TEXT NOT NULL DEFAULT '[]',prompt_tokens INTEGER,completion_tokens INTEGER,cost_rub REAL,billing_unknown INTEGER NOT NULL DEFAULT 0);
     CREATE INDEX ai_jobs_status ON ai_jobs(status);
     PRAGMA user_version=2;`);
        const rows = await this.db.getAllAsync<{ snapshot: string }>(
          "SELECT snapshot FROM entities",
        );
        for (const row of rows) {
          const entity: Entity = JSON.parse(row.snapshot);
          const history = await super.history(entity.id);
          // The old local snapshot may contain unsent edits. Give it a new, exact local revision.
          entity.revision =
            Math.max(entity.revision, ...history.map((h) => h.revision), 0) + 1;
          await this.record(entity);
        }
      }
      await this.db.runAsync(
        "UPDATE ai_jobs SET status='interrupted',error='interrupted',updated_at=? WHERE status IN ('queued','running')",
        new Date().toISOString(),
      );
    });
  }
  private async record(entity: Entity) {
    await this.put(entity, "local");
    const value = JSON.stringify(entity);
    await this.db.runAsync(
      "INSERT INTO local_revisions VALUES (?,?,?)",
      entity.id,
      entity.revision,
      value,
    );
    await this.db.runAsync(
      "INSERT INTO history(entity_id,snapshot) VALUES (?,?)",
      entity.id,
      value,
    );
  }
  async revision(id: string, revision: number): Promise<Entity | null> {
    const row = await this.db.getFirstAsync<{ snapshot: string }>(
      "SELECT snapshot FROM local_revisions WHERE entity_id=? AND revision=?",
      id,
      revision,
    );
    return row ? JSON.parse(row.snapshot) : null;
  }
  private async validate(
    kind: Kind,
    content: ReturnType<typeof contentFor>,
    id: string,
  ) {
    if (kind === "entry") return;
    const k = content as KnowledgeContent;
    const entries = new Set<string>();
    for (const ref of k.evidence) {
      const target = await this.get(ref.id);
      if (
        ref.id === id ||
        !target ||
        target.deleted_at ||
        !(await this.revision(ref.id, ref.revision))
      )
        throw new Error("Источник удалён или его точная версия недоступна.");
      if (target.kind === "entry") entries.add(ref.id);
    }
    if (kind === "pattern" && entries.size < 3)
      throw new Error("Для паттерна нужны как минимум три разные записи.");
    if (kind === "experiment") {
      const hypothesis = await this.get(k.hypothesis_id!);
      if (
        !hypothesis ||
        hypothesis.kind !== "hypothesis" ||
        hypothesis.deleted_at ||
        (k.status === "active" && hypothesis.content.status !== "active")
      )
        throw new Error("Для активного эксперимента нужна активная гипотеза.");
    }
  }
  async save(
    kind: string,
    content: EntryContent | KnowledgeContent,
    id = this.makeId(),
    deleted = false,
    expectedRevision?: number,
  ) {
    const parsedKind = kindSchema.parse(kind),
      parsed = contentFor(parsedKind, content);
    await this.transaction(async () => {
      const previous = await this.get(id);
      if (
        previous &&
        expectedRevision !== undefined &&
        previous.revision !== expectedRevision
      )
        throw new Error(
          "Запись уже изменилась. Скопируйте свой текст и откройте актуальную версию.",
        );
      if (previous && previous.kind !== kind)
        throw new Error("Тип записи нельзя изменить.");
      if (!deleted) await this.validate(parsedKind, parsed, id);
      const at = new Date().toISOString();
      await this.record({
        id,
        kind,
        content: {
          ...parsed,
          ...(previous?.content.ai ? { ai: previous.content.ai } : {}),
        },
        revision: (previous?.revision ?? 0) + 1,
        source: "user",
        created_at: previous?.created_at ?? at,
        updated_at: at,
        deleted_at: deleted ? at : null,
      });
    });
    return id;
  }
  async resolve(
    conflict: LocalConflict,
    content: EntryContent | KnowledgeContent,
    deleted: boolean,
  ) {
    const { ai, ...editable } = content as Record<string, unknown>;
    await this.transaction(async () => {
      const local = await this.get(conflict.entity_id);
      if (!local) throw new Error("Запись не найдена.");
      const kind = kindSchema.parse(local.kind),
        parsed = contentFor(kind, editable);
      if (!deleted) await this.validate(kind, parsed, local.id);
      await this.record({
        ...local,
        content: { ...parsed, ...(ai ? { ai } : {}) },
        revision: local.revision + 1,
        updated_at: new Date().toISOString(),
        deleted_at: deleted ? new Date().toISOString() : null,
      });
      await this.db.runAsync(
        "DELETE FROM conflicts WHERE entity_id=?",
        local.id,
      );
    });
  }
  async conflicts() {
    return this.db.getAllAsync<LocalConflict>("SELECT * FROM conflicts");
  }
  async jobs() {
    return this.db.getAllAsync<AIJob>(
      "SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT 100",
    );
  }
  async createJob(
    kind: AIKind,
    refs: { id: string; revision: number }[],
    model: string,
    context: Record<string, string> = {},
  ) {
    const id = this.makeId(),
      at = new Date().toISOString();
    await this.transaction(async () => {
      if (
        await this.db.getFirstAsync(
          "SELECT id FROM ai_jobs WHERE status IN ('queued','running') LIMIT 1",
        )
      )
        throw new Error("Дождитесь завершения текущего анализа.");
      await this.db.runAsync(
        "INSERT INTO ai_jobs(id,kind,status,sources,context,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        id,
        kind,
        "queued",
        JSON.stringify(refs),
        JSON.stringify(context),
        model,
        at,
        at,
      );
    });
    return id;
  }
  async setJob(id: string, status: string, error: string | null = null) {
    await this.transaction(async () => {
      await this.db.runAsync(
        "UPDATE ai_jobs SET status=?,error=?,updated_at=?,billing_unknown=CASE WHEN ?='running' THEN 1 ELSE billing_unknown END WHERE id=? AND status NOT IN ('completed','cancelled')",
        status,
        error,
        new Date().toISOString(),
        status,
        id,
      );
    });
  }
  async completeJob(
    id: string,
    items: unknown[],
    usage: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      cost_rub: number | null;
    },
    providerModel: string,
  ) {
    await this.transaction(async () => {
      const job = await this.db.getFirstAsync<AIJob>(
        "SELECT * FROM ai_jobs WHERE id=?",
        id,
      );
      if (!job) return;
      await this.db.runAsync(
        "UPDATE ai_jobs SET prompt_tokens=?,completion_tokens=?,cost_rub=?,billing_unknown=? WHERE id=?",
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.cost_rub,
        usage.cost_rub === null ? 1 : 0,
        id,
      );
      if (job.status !== "running") return;
      const sources = JSON.parse(job.sources) as {
        id: string;
        revision: number;
      }[];
      for (const ref of sources) {
        const current = await this.get(ref.id);
        if (
          !current ||
          current.deleted_at ||
          current.revision !== ref.revision
        ) {
          await this.db.runAsync(
            "UPDATE ai_jobs SET status='failed',error='stale_source' WHERE id=?",
            id,
          );
          return;
        }
      }
      const permitted = new Set(sources.map((r) => `${r.id}/${r.revision}`));
      const ids: string[] = [];
      // Validate all items before writing any entity.
      const parsed = items.map(
        (item) =>
          contentFor(job.kind, {
            ...knowledgeSchema.parse(item),
            status: "draft",
          }) as ReturnType<typeof knowledgeSchema.parse>,
      );
      for (const item of parsed) {
        if (item.evidence.some((r) => !permitted.has(`${r.id}/${r.revision}`)))
          throw new Error("invalid_evidence");
        await this.validate(job.kind, item, "");
      }
      for (const item of parsed) {
        const entityId = this.makeId(),
          at = new Date().toISOString();
        ids.push(entityId);
        await this.record({
          id: entityId,
          kind: job.kind,
          content: {
            ...item,
            ai: {
              provider: "polza",
              model: providerModel,
              prompt_version: "standalone-1.0",
              source_revisions: sources,
              ...JSON.parse(job.context),
            },
          },
          revision: 1,
          source: "ai",
          created_at: at,
          updated_at: at,
          deleted_at: null,
        });
      }
      await this.db.runAsync(
        "UPDATE ai_jobs SET status='completed',result_ids=?,updated_at=? WHERE id=?",
        JSON.stringify(ids),
        new Date().toISOString(),
        id,
      );
    });
  }
  async recordUsage(
    id: string,
    usage: {
      prompt_tokens: number | null;
      completion_tokens: number | null;
      cost_rub: number | null;
    },
  ) {
    await this.transaction(async () => {
      await this.db.runAsync(
        "UPDATE ai_jobs SET prompt_tokens=?,completion_tokens=?,cost_rub=?,billing_unknown=? WHERE id=?",
        usage.prompt_tokens,
        usage.completion_tokens,
        usage.cost_rub,
        usage.cost_rub === null ? 1 : 0,
        id,
      );
    });
  }
  async statistics() {
    return {
      entries: (await this.all("entry")).length,
      insights: (await this.all()).filter((e) => e.kind !== "entry").length,
      ...(await this.db.getFirstAsync<{
        requests: number;
        completed: number;
        tokens: number;
        cost_rub: number;
        unknown: number;
      }>(
        "SELECT COUNT(*) requests,COALESCE(SUM(status='completed'),0) completed,COALESCE(SUM(COALESCE(prompt_tokens,0)+COALESCE(completion_tokens,0)),0) tokens,COALESCE(SUM(cost_rub),0) cost_rub,COALESCE(SUM(billing_unknown),0) unknown FROM ai_jobs",
      ))!,
    };
  }
  async backup() {
    return this.transaction(async () => ({
      format: "lumen-standalone" as const,
      version: 2 as const,
      exported_at: new Date().toISOString(),
      entities: (
        await this.db.getAllAsync<{ snapshot: string }>(
          "SELECT snapshot FROM entities",
        )
      ).map((r) => JSON.parse(r.snapshot)),
      revisions: (
        await this.db.getAllAsync<{ snapshot: string }>(
          "SELECT snapshot FROM local_revisions",
        )
      ).map((r) => JSON.parse(r.snapshot)),
    }));
  }
  async restoreBackup(input: unknown) {
    const backup = backupSchema.parse(input);
    const ids = new Set(backup.entities.map((e) => e.id));
    if (ids.size !== backup.entities.length)
      throw new Error("Повторяющиеся записи в архиве.");
    const refs = new Map(
      backup.revisions.map((e) => [`${e.id}/${e.revision}`, e]),
    );
    if (refs.size !== backup.revisions.length)
      throw new Error("Повторяющиеся версии в архиве.");
    for (const e of [...backup.entities, ...backup.revisions]) {
      const { ai, ...content } = e.content;
      contentFor(e.kind, content);
      if (!ids.has(e.id)) throw new Error("Неполный архив.");
    }
    await this.transaction(async () => {
      for (const e of backup.entities) {
        const previous = await this.get(e.id);
        if (previous) {
          const { sync, ...old } = previous;
          if (canonical(old) !== canonical(e))
            throw new Error(
              "Архив содержит другую версию существующей записи. Импорт отменён.",
            );
        }
        const current = refs.get(`${e.id}/${e.revision}`);
        if (!current || canonical(current) !== canonical(e))
          throw new Error("Текущая версия отсутствует в архиве.");
      }
      for (const e of backup.revisions) {
        const existing = await this.revision(e.id, e.revision);
        if (existing && canonical(existing) !== canonical(e))
          throw new Error("История версий отличается. Импорт отменён.");
      }
      for (const e of backup.revisions) {
        await this.db.runAsync(
          "INSERT OR IGNORE INTO local_revisions VALUES (?,?,?)",
          e.id,
          e.revision,
          JSON.stringify(e),
        );
      }
      for (const e of backup.entities) {
        if (!(await this.get(e.id))) await this.put(e, "local");
      }
    });
    return backup.entities.length;
  }
  async history(id: string) {
    return (
      await this.db.getAllAsync<{ snapshot: string }>(
        "SELECT snapshot FROM local_revisions WHERE entity_id=? ORDER BY revision DESC",
        id,
      )
    ).map((r) => JSON.parse(r.snapshot) as Entity);
  }
  async clear() {
    await this.transaction(async () => {
      await this.db.execAsync(
        "DELETE FROM ai_jobs; DELETE FROM local_revisions; DELETE FROM outbox; DELETE FROM conflicts; DELETE FROM history; DELETE FROM entities; DELETE FROM meta;",
      );
    });
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return JSON.stringify(value.map((v) => JSON.parse(canonical(v))));
  if (value && typeof value === "object")
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, JSON.parse(canonical(v))]),
      ),
    );
  return JSON.stringify(value);
}
