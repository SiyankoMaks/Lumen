import { type Entity, Repository } from "../db/repository";

export const paths: Record<string, string> = {
  entry: "/entries",
  structured_entry: "/structures",
  pattern: "/patterns",
  hypothesis: "/hypotheses",
  experiment: "/experiments",
  experiment_suggestion: "/experiment-suggestions",
  weekly_review: "/reviews/weekly",
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public data: any,
  ) {
    super(`HTTP ${status}`);
  }
}
export interface Transport {
  request<T>(path: string, method?: string, body?: unknown): Promise<T>;
}

export class SyncEngine {
  private running: Promise<void> | null = null;
  private paused = false;
  async pause() {
    this.paused = true;
    try {
      await this.running;
    } catch {
      /* caller handles offline state */
    }
  }
  resume() {
    this.paused = false;
  }
  constructor(
    private repo: Repository,
    private api: Transport,
    private changed: () => void = () => {},
    private random = Math.random,
    private clock = Date.now,
  ) {}
  run() {
    if (this.paused) return Promise.resolve();
    if (!this.running)
      this.running = this.perform().finally(() => {
        this.running = null;
      });
    return this.running;
  }
  private async perform() {
    const blocked = new Set<string>();
    // Re-read after each ack: causally dependent payloads receive the confirmed revision.
    const ids = (await this.repo.queue()).map((op) => op.seq);
    for (const seq of ids) {
      if (this.paused) return;
      const op = (await this.repo.queue()).find((o) => o.seq === seq);
      if (!op || blocked.has(op.entity_id)) continue;
      if (
        ["conflict", "blocked"].includes(op.status) ||
        op.next_retry_at > this.clock()
      ) {
        blocked.add(op.entity_id);
        continue;
      }
      const payload = await this.repo.seal(op);
      if (!payload) continue;
      try {
        const path =
          op.action === "resolve"
            ? `/conflicts/${op.conflict_id}/resolve`
            : paths[op.kind] +
              (op.action === "create" ? "" : `/${op.entity_id}`);
        const method =
          op.action === "create" || op.action === "resolve"
            ? "POST"
            : op.action === "delete"
              ? "DELETE"
              : "PATCH";
        const result = await this.api.request<Entity>(path, method, payload);
        await this.repo.acknowledge(op, result);
      } catch (error) {
        blocked.add(op.entity_id);
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.data.conflict_id
        )
          await this.repo.conflict(op, error.data);
        else if (
          error instanceof ApiError &&
          [401, 403].includes(error.status)
        ) {
          await this.repo.fail(op, "pending", "Войдите в аккаунт");
          break;
        } else if (
          !(error instanceof ApiError) ||
          error.status === 429 ||
          error.status >= 500
        ) {
          const delay =
            Math.min(300000, 1000 * 2 ** Math.min(op.attempt_count, 8)) *
            (0.75 + this.random() * 0.5);
          await this.repo.fail(
            op,
            "failed_retryable",
            "Нет соединения. Данные на устройстве.",
            this.clock() + delay,
          );
        } else
          await this.repo.fail(
            op,
            "blocked",
            "Изменение не принято. Откройте запись и исправьте данные.",
          );
      }
      this.changed();
    }
    // UUID keyset scan includes tombstones. No timestamp cursor can lose a late transaction.
    for (const path of Object.values(paths)) {
      if (this.paused) return;
      let after = "";
      while (true) {
        const page = await this.api.request<Entity[]>(
          `${path}?include_deleted=true&limit=100&after=${after}`,
        );
        for (const entity of page) await this.repo.receive(entity);
        if (page.length < 100) break;
        after = page[page.length - 1].id;
      }
    }
    this.changed();
  }
}
