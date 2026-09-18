import { resultSchema, type AIKind } from "../domain/local";
import { LocalRepository } from "../db/local";
import { Polza, PolzaError, type PolzaConfig } from "./polza";
import type { Entity } from "../db/repository";
export class AIService {
  failure = "";
  private active: { id: string; controller: AbortController } | null = null;
  constructor(
    private repo: LocalRepository,
    private settings: () => Promise<PolzaConfig | null>,
    private provider = new Polza(),
    private changed: () => void = () => {},
    private timeout = 90000,
  ) {}
  async start(
    kind: AIKind,
    refs: { id: string; revision: number }[],
    context: Record<string, string> = {},
  ) {
    if (this.active) throw new Error("Уже выполняется анализ.");
    const config = await this.settings();
    if (!config)
      throw new Error("Добавьте API-ключ и модель Polza в настройках.");
    if (
      !refs.length ||
      refs.length > 100 ||
      new Set(refs.map((r) => r.id)).size !== refs.length
    )
      throw new Error("Выберите от 1 до 100 разных источников.");
    const sources: Entity[] = [];
    for (const ref of refs) {
      const source = await this.repo.get(ref.id);
      if (!source || source.deleted_at || source.revision !== ref.revision)
        throw new Error("Источник изменился. Откройте его заново.");
      const { sync, ...entity } = source;
      sources.push(entity);
    }
    if (
      kind === "structured_entry" &&
      (sources.length !== 1 || sources[0].kind !== "entry")
    )
      throw new Error("Выберите одну запись.");
    if (
      kind === "pattern" &&
      sources.filter((s) => s.kind === "entry").length < 3
    )
      throw new Error("Нужно как минимум три записи.");
    if (
      kind === "experiment_suggestion" &&
      sources.some((s) => s.kind !== "hypothesis")
    )
      throw new Error("Выберите гипотезу.");
    if (kind === "weekly_review") {
      const start = new Date(context.period_start).getTime(),
        end = new Date(context.period_end).getTime();
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start ||
        end - start > 7 * 86400000
      )
        throw new Error("Период обзора — не более семи дней.");
      if (
        sources.some(
          (s) =>
            s.kind === "entry" &&
            (new Date(String(s.content.occurred_at)).getTime() < start ||
              new Date(String(s.content.occurred_at)).getTime() >= end),
        )
      )
        throw new Error("Запись не входит в период обзора.");
    }
    if (JSON.stringify(sources).length > 60000)
      throw new Error("Слишком много текста. Выберите меньше записей.");
    const id = await this.repo.createJob(kind, refs, config.model, context);
    const controller = new AbortController();
    this.active = { id, controller };
    this.changed();
    this.failure = "";
    void this.perform(id, config, kind, sources, context, controller).catch(
      () => {
        this.failure =
          "Не удалось сохранить статус анализа. Проверьте свободное место и перезапустите приложение.";
        this.changed();
      },
    );
    return id;
  }
  private async perform(
    id: string,
    config: PolzaConfig,
    kind: AIKind,
    sources: Entity[],
    context: Record<string, string>,
    controller: AbortController,
  ) {
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      await this.repo.setJob(id, "running");
      this.changed();
      if (controller.signal.aborted) throw new PolzaError("interrupted");
      const response = await this.provider.complete(
        config,
        kind,
        sources,
        context,
        controller.signal,
      );
      await this.repo.recordUsage(id, response.usage);
      if (controller.signal.aborted) throw new PolzaError("interrupted");
      if (response.finishReason !== "stop" || typeof response.text !== "string")
        throw new PolzaError("invalid_response");
      let result;
      try {
        result = resultSchema.parse(JSON.parse(response.text));
      } catch {
        throw new PolzaError("invalid_response");
      }
      await this.repo.completeJob(
        id,
        result.items,
        response.usage,
        response.model,
      );
    } catch (e) {
      await this.repo.setJob(
        id,
        "failed",
        e instanceof PolzaError
          ? e.code
          : e instanceof Error && e.message === "invalid_evidence"
            ? "invalid_evidence"
            : "invalid_response",
      );
    } finally {
      clearTimeout(timer);
      this.active = null;
      this.changed();
    }
  }
  async cancel(id?: string) {
    if (this.active && (!id || id === this.active.id)) {
      const active = this.active;
      active.controller.abort();
      await this.repo.setJob(active.id, "cancelled", "cancelled");
      this.changed();
    }
  }
  async idle() {
    while (this.active) await new Promise((r) => setTimeout(r, 10));
  }
}
