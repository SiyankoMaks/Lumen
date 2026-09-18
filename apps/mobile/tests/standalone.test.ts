import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { LocalRepository } from "../src/db/local";
import { Repository, type SQL } from "../src/db/repository";
import { AIService } from "../src/ai/service";
import { Polza, PolzaError } from "../src/ai/polza";
function sql() {
  const db = new DatabaseSync(":memory:");
  const adapter: SQL = {
    async execAsync(s) {
      db.exec(s);
    },
    async runAsync(s, ...a) {
      return db.prepare(s).run(...a);
    },
    async getAllAsync<T>(s: string, ...a: any[]) {
      return db.prepare(s).all(...a) as T[];
    },
    async getFirstAsync<T>(s: string, ...a: any[]) {
      return (db.prepare(s).get(...a) ?? null) as T | null;
    },
  };
  return { db, adapter };
}
async function setup() {
  const { db, adapter } = sql();
  const repo = new LocalRepository(adapter, randomUUID);
  await repo.migrate();
  return { repo, db, adapter };
}
const note = (text: string) => ({
  type: "note" as const,
  text,
  occurred_at: "2026-09-18T10:00:00Z",
  tags: [],
  metadata: {},
});
const config = {
  apiKey: "test-only-key-not-real",
  model: "test/model",
  maxTokens: 2048,
};
const usage = { prompt_tokens: 20, completion_tokens: 30, cost_rub: 0.125 };
function fake(result: unknown, onCall?: () => Promise<void>) {
  let calls = 0;
  const provider = {
    async complete() {
      calls++;
      await onCall?.();
      return {
        text: JSON.stringify(result),
        finishReason: "stop",
        usage,
        model: "test/model",
      };
    },
  } as unknown as Polza;
  return { provider, calls: () => calls };
}

test("standalone CRUD increments exact revisions offline and never queues cloud operations", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("first"));
  await repo.save("entry", note("second"), id, false, 1);
  assert.equal((await repo.get(id))?.revision, 2);
  assert.equal((await repo.revision(id, 1))?.content.text, "first");
  assert.equal((await repo.queue()).length, 0);
  await assert.rejects(() => repo.save("entry", note("stale"), id, false, 1));
  await repo.save("entry", note("second"), id, true, 2);
  assert.equal((await repo.all()).length, 0);
  assert.equal((await repo.history(id)).length, 3);
  db.close();
});

test("v1 migration preserves unsent edits, original outbox and legacy conflict snapshots", async () => {
  const { db, adapter } = sql();
  const old = new Repository(adapter, randomUUID);
  await old.migrate();
  const id = await old.save("entry", note("first"));
  await old.save("entry", note("unsent edit"), id);
  const oldQueue = await old.queue();
  const repo = new LocalRepository(adapter, randomUUID);
  await repo.migrate();
  await repo.migrate();
  assert.equal((await repo.get(id))?.content.text, "unsent edit");
  assert.equal((await repo.get(id))?.sync, "local");
  assert.deepEqual(await repo.queue(), oldQueue);
  assert.equal((await repo.revision(id, 1))?.content.text, "unsent edit");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM history").get()?.n, 3);
  db.close();
});

test("AI response saves evidence/provenance and exact history; editing preserves provenance", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("walk"));
  const result = {
    items: [{ title: "Observation", evidence: [{ id, revision: 1 }] }],
  };
  const { provider, calls } = fake(result);
  const service = new AIService(repo, async () => config, provider);
  await service.start("structured_entry", [{ id, revision: 1 }]);
  await service.idle();
  const job = (await repo.jobs())[0];
  assert.equal(job.status, "completed");
  assert.equal(calls(), 1);
  const item = (await repo.all("structured_entry"))[0];
  const { ai, ...content } = item.content;
  await repo.save(
    "structured_entry",
    { ...content, description: "my correction" } as any,
    item.id,
    false,
    1,
  );
  assert.deepEqual((await repo.get(item.id))?.content.ai, ai);
  assert.equal((await repo.history(item.id)).length, 2);
  assert.equal((await repo.statistics()).cost_rub, 0.125);
  db.close();
});

test("stale sources cannot publish AI results and actual cost stays recorded", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("old"));
  const { provider } = fake({ items: [] }, async () => {
    await repo.save("entry", note("new"), id);
  });
  const service = new AIService(repo, async () => config, provider);
  await service.start("structured_entry", [{ id, revision: 1 }]);
  await service.idle();
  assert.equal((await repo.jobs())[0].error, "stale_source");
  assert.equal((await repo.statistics()).cost_rub, 0.125);
  db.close();
});

test("invented evidence rolls back every result while preserving request cost", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("real"));
  const { provider } = fake({
    items: [
      { title: "Valid", evidence: [{ id, revision: 1 }] },
      { title: "Invalid", evidence: [{ id: randomUUID(), revision: 1 }] },
    ],
  });
  const service = new AIService(repo, async () => config, provider);
  await service.start("structured_entry", [{ id, revision: 1 }]);
  await service.idle();
  assert.equal((await repo.all("structured_entry")).length, 0);
  assert.equal((await repo.jobs())[0].error, "invalid_evidence");
  assert.equal((await repo.statistics()).cost_rub, 0.125);
  db.close();
});

test("cancellation prevents late response publication; no automatic retry on restart", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("real"));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { provider, calls } = fake({ items: [] }, () => gate);
  const service = new AIService(repo, async () => config, provider);
  await service.start("structured_entry", [{ id, revision: 1 }]);
  await service.cancel();
  release();
  await service.idle();
  assert.equal((await repo.jobs())[0].status, "cancelled");
  assert.equal(calls() <= 1, true);
  const next = await repo.createJob(
    "structured_entry",
    [{ id, revision: 1 }],
    config.model,
  );
  await repo.setJob(next, "running");
  await repo.migrate();
  assert.equal(
    (await repo.jobs()).find((j) => j.id === next)?.status,
    "interrupted",
  );
  db.close();
});

test("backup roundtrip is atomic; mismatched existing versions cannot overwrite data", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("original"));
  const backup = await repo.backup();
  const second = await setup();
  await second.repo.restoreBackup(backup);
  await second.repo.restoreBackup(backup);
  assert.equal((await second.repo.all()).length, 1);
  await second.repo.save("entry", note("newer"), id);
  await assert.rejects(() => second.repo.restoreBackup(backup));
  assert.equal((await second.repo.get(id))?.content.text, "newer");
  assert.equal(JSON.stringify(backup).includes("apiKey"), false);
  db.close();
  second.db.close();
});

test("Polza transport fixes destination, captures RUB usage, never retries or leaks response errors", async () => {
  let calls = 0;
  const provider = new Polza(async (url, init) => {
    calls++;
    assert.equal(url, "https://polza.ai/api/v1/chat/completions");
    assert.equal(
      (init?.headers as any).Authorization,
      "Bearer " + config.apiKey,
    );
    return new Response(
      JSON.stringify({
        model: "actual/model",
        choices: [
          { message: { content: '{"items":[]}' }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, cost_rub: 0.03 },
      }),
      { status: 200 },
    );
  });
  const response = await provider.complete(
    config,
    "pattern",
    [],
    {},
    new AbortController().signal,
  );
  assert.equal(response.usage.cost_rub, 0.03);
  assert.equal(calls, 1);
  const invalid = new Polza(
    async () => new Response("secret-private-provider-body", { status: 401 }),
  );
  await assert.rejects(
    () => invalid.models(config.apiKey),
    (e: any) =>
      e instanceof PolzaError &&
      e.code === "invalid_key" &&
      !e.message.includes("secret"),
  );
});

test("missing key and invalid weekly period cause no job and no provider request", async () => {
  const { repo, db } = await setup();
  const id = await repo.save("entry", note("test"));
  const f = fake({ items: [] });
  await assert.rejects(() =>
    new AIService(repo, async () => null, f.provider).start(
      "structured_entry",
      [{ id, revision: 1 }],
    ),
  );
  await assert.rejects(() =>
    new AIService(repo, async () => config, f.provider).start(
      "weekly_review",
      [{ id, revision: 1 }],
      { period_start: "bad", period_end: "bad" },
    ),
  );
  assert.equal(f.calls(), 0);
  assert.equal((await repo.jobs()).length, 0);
  db.close();
});
