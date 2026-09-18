import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useLocal, useLumen } from "../../src/shared/provider";
import { aiErrors } from "../../src/ai/polza";
import type { AIKind } from "../../src/domain/local";
import {
  AppCard,
  Button,
  Chips,
  EmptyState,
  ErrorState,
  Label,
  Screen,
  Skeleton,
} from "../../src/shared/ui";
export default function Insights() {
  const [tab, setTab] = useState("pattern"),
    [message, setMessage] = useState("");
  const { data, error } = useLocal(async (r) => ({
    entities: await r.all(),
    jobs: await r.jobs(),
  }));
  const { ai } = useLumen();
  function analyze(kind: AIKind) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date();
    const sources = (data?.entities ?? [])
      .filter((e) =>
        kind === "weekly_review"
          ? (e.kind !== "entry" &&
              ["active", "completed"].includes(String(e.content.status))) ||
            (new Date(String(e.content.occurred_at ?? e.created_at)) >= start &&
              new Date(String(e.content.occurred_at ?? e.created_at)) < end)
          : kind === "pattern"
            ? e.kind === "entry"
            : e.kind === "pattern",
      )
      .slice(0, 100);
    if (!sources.length) {
      setMessage("Пока нет подходящих источников. Сначала создайте записи.");
      return;
    }
    Alert.alert(
      "Анализ в Polza",
      `Будет отправлено источников: ${sources.length}. Запрос оплачивается с вашего баланса Polza.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Отправить",
          onPress: () =>
            void ai
              .start(
                kind,
                sources.map((e) => ({ id: e.id, revision: e.revision })),
                kind === "weekly_review"
                  ? {
                      period_start: start.toISOString(),
                      period_end: end.toISOString(),
                    }
                  : {},
              )
              .then(() =>
                setMessage("Анализ начат. Оставьте приложение открытым."),
              )
              .catch((e) =>
                setMessage(
                  e instanceof Error ? e.message : "Не удалось начать анализ.",
                ),
              ),
        },
      ],
    );
  }
  const rows = data?.entities.filter((e) => e.kind === tab);
  return (
    <Screen title="Инсайты">
      <Label muted>Наблюдения, которые можно проверить.</Label>
      <Chips
        items={[
          { id: "pattern", label: "Паттерны" },
          { id: "hypothesis", label: "Гипотезы" },
          { id: "experiment", label: "Эксперименты" },
          { id: "weekly_review", label: "Обзор недели" },
          { id: "experiment_suggestion", label: "Предложения" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {error && <ErrorState message={error} />}
      {message && <ErrorState message={message} />}
      {!rows ? (
        <Skeleton />
      ) : rows.length ? (
        rows.map((e) => (
          <AppCard key={e.id}>
            <Label>{String(e.content.title)}</Label>
            <Label muted>{String(e.content.description ?? "")}</Label>
            <Label muted>
              Источников: {(e.content.evidence as unknown[])?.length ?? 0}
            </Label>
            <Button
              secondary
              label="Подробнее и доказательства"
              onPress={() => router.push(`/knowledge/${e.id}`)}
            />
          </AppCard>
        ))
      ) : (
        <EmptyState
          title="Пока нет наблюдений"
          description="Выводы появятся после анализа ваших записей. Каждый вывод связан с источниками."
        />
      )}
      {["pattern", "hypothesis", "weekly_review"].includes(tab) && (
        <Button
          label="Запросить анализ"
          onPress={() => analyze(tab as AIKind)}
        />
      )}
      <Button
        secondary
        label="Настроить Polza"
        onPress={() => router.push("/profile")}
      />
      {data?.jobs.slice(0, 10).map((job) => (
        <AppCard key={job.id}>
          <Label>
            {
              (
                {
                  queued: "Подготовка",
                  running: "Анализируем…",
                  completed: JSON.parse(job.result_ids).length
                    ? "Анализ завершён"
                    : "Анализ завершён: данных для вывода недостаточно",
                  failed: "Анализ не завершён",
                  cancelled: "Анализ отменён",
                  interrupted: "Анализ был прерван",
                } as Record<string, string>
              )[job.status]
            }
          </Label>
          <Label muted>
            {new Date(job.created_at).toLocaleString("ru-RU")} · {job.model}
          </Label>
          {job.error && (
            <Label muted>
              {aiErrors[job.error] ??
                "Ответ не удалось применить. Записи сохранены."}
            </Label>
          )}
          {["queued", "running"].includes(job.status) && (
            <Button
              secondary
              label="Отменить анализ"
              onPress={() => void ai.cancel(job.id)}
            />
          )}
        </AppCard>
      ))}
    </Screen>
  );
}
