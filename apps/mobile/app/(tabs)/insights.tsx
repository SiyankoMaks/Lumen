import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { useLocal, useLumen } from "../../src/shared/provider";
import {
  AppCard,
  Button,
  Chips,
  EmptyState,
  ErrorState,
  Label,
  Screen,
  Skeleton,
  SyncBadge,
} from "../../src/shared/ui";
export default function Insights() {
  const [tab, setTab] = useState("pattern"),
    [message, setMessage] = useState("");
  const { data, error } = useLocal((r) => r.all());
  const { client, sync } = useLumen();
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () =>
      client.request<
        { id: string; kind: string; status: string; error: string | null }[]
      >("/ai/jobs"),
    enabled: !!client.tokens,
    refetchInterval: 15000,
  });
  async function analyze(kind: string) {
    if (!client.tokens) {
      router.push("/auth");
      return;
    }
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const sources = (data ?? [])
      .filter(
        (e) =>
          e.sync === "synced" &&
          (kind === "weekly_review"
            ? new Date(String(e.content.occurred_at ?? e.created_at)) >= monday
            : kind === "pattern"
              ? e.kind === "entry"
              : e.kind === "pattern"),
      )
      .slice(0, 100);
    if (!sources.length) {
      setMessage("Для анализа нужны синхронизированные записи или паттерны.");
      return;
    }
    try {
      await client.request("/ai/jobs", "POST", {
        operation_id: Crypto.randomUUID(),
        kind,
        sources: sources.map((e) => ({ id: e.id, revision: e.revision })),
        ...(kind === "weekly_review"
          ? {
              period_start: monday.toISOString(),
              period_end: new Date().toISOString(),
            }
          : {}),
      });
      setMessage(
        "Запрос поставлен в очередь. Анализ можно просмотреть после завершения.",
      );
      void jobs.refetch();
    } catch {
      setMessage("Не удалось запустить анализ. Записи сохранены.");
    }
  }
  const rows = data?.filter((e) => e.kind === tab);
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
      {error && <ErrorState message={error} />}{" "}
      {message && <ErrorState message={message} />}{" "}
      {!rows ? (
        <Skeleton />
      ) : rows.length ? (
        rows.map((e) => (
          <AppCard key={e.id}>
            <Label>{String(e.content.title)}</Label>
            <Label muted>{String(e.content.description ?? "")}</Label>
            <Label muted>
              Связанных источников:{" "}
              {(e.content.evidence as unknown[])?.length ?? 0}
            </Label>
            <SyncBadge status={e.sync} />
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
          description="Выводы появятся, когда накопится достаточно связанных записей. Каждый вывод сохраняет ссылки на источники."
        />
      )}
      {["pattern", "hypothesis", "weekly_review"].includes(tab) && (
        <Button
          label="Запросить анализ"
          onPress={() =>
            Alert.alert(
              "Анализ выбранных данных",
              "В AI будут отправлены до 100 подходящих синхронизированных источников: записи для паттернов, паттерны для гипотез или данные текущей недели для обзора.",
              [
                { text: "Отмена", style: "cancel" },
                { text: "Отправить", onPress: () => void analyze(tab) },
              ],
            )
          }
        />
      )}
      {jobs.data
        ?.filter((j) => j.status !== "completed")
        .map((j) => (
          <AppCard key={j.id}>
            {["queued", "running"].includes(j.status) && (
              <Button
                secondary
                label="Отменить анализ"
                onPress={() =>
                  void client
                    .request(`/ai/jobs/${j.id}/cancel`, "POST")
                    .then(() => jobs.refetch())
                    .catch(() => setMessage("Не удалось отменить анализ."))
                }
              />
            )}
            <Label>
              {(
                {
                  queued: "В очереди",
                  running: "Анализируем…",
                  failed: "Анализ не завершён",
                  cancelled: "Отменён",
                } as Record<string, string>
              )[j.status] ?? j.status}
            </Label>
            {j.status === "failed" && (
              <>
                <Label muted>
                  Записи сохранены. Проверьте доступность AI в настройках
                  сервера.
                </Label>
                <Button
                  secondary
                  label="Повторить анализ"
                  onPress={() =>
                    void client
                      .request(`/ai/jobs/${j.id}/retry`, "POST")
                      .then(() => jobs.refetch())
                      .catch(() => setMessage("Не удалось повторить запрос."))
                  }
                />
              </>
            )}
          </AppCard>
        ))}
      <Button secondary label="Обновить" onPress={() => void sync()} />
    </Screen>
  );
}
