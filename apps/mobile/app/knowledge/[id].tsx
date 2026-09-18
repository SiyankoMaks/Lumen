import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useLocal, useLumen } from "../../src/shared/provider";
import {
  AppCard,
  Button,
  Chips,
  ErrorState,
  Input,
  Label,
  Screen,
  Skeleton,
  SyncBadge,
} from "../../src/shared/ui";
import type { KnowledgeContent, Entity } from "../../src/db/repository";
import { displayDate, parseDate } from "../../src/shared/dates";
const allowed: Record<string, string[]> = {
  structured_entry: ["draft", "active", "rejected", "archived"],
  pattern: ["draft", "active", "rejected", "archived"],
  hypothesis: [
    "draft",
    "active",
    "supported",
    "weakened",
    "rejected",
    "archived",
  ],
  experiment: ["draft", "active", "completed", "cancelled", "archived"],
  experiment_suggestion: ["draft", "active", "rejected", "archived"],
  weekly_review: ["draft", "active", "archived"],
};
const statuses = [
  { id: "draft", label: "Предложение" },
  { id: "active", label: "Активно" },
  { id: "supported", label: "Поддержано" },
  { id: "weakened", label: "Ослаблено" },
  { id: "rejected", label: "Отклонено" },
  { id: "archived", label: "В архиве" },
  { id: "completed", label: "Завершено" },
  { id: "cancelled", label: "Отменено" },
];
export default function Knowledge() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { repo, ai, changed } = useLumen();
  const { data, error } = useLocal((r) => r.get(id), [id]);
  const [content, setContent] = useState<KnowledgeContent | null>(null),
    [message, setMessage] = useState(""),
    [loaded, setLoaded] = useState(false),
    [baseRevision, setBaseRevision] = useState<number | undefined>(undefined),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [revisions, setRevisions] = useState<Entity[]>([]);
  useEffect(() => {
    if (data && !loaded) {
      const { ai, ...editable } = data.content;
      setContent(editable as KnowledgeContent);
      setBaseRevision(data.revision);
      setStart(editable.start_at ? displayDate(String(editable.start_at)) : "");
      setEnd(editable.end_at ? displayDate(String(editable.end_at)) : "");
      setLoaded(true);
    }
  }, [data, loaded]);
  function field(key: keyof KnowledgeContent, value: unknown) {
    setContent((c) => (c ? { ...c, [key]: value } : null));
  }
  async function save() {
    if (!data || !content) return;
    try {
      if (!content.title.trim()) throw new Error("Введите формулировку.");
      const value = {
        ...content,
        start_at: start ? parseDate(start).toISOString() : null,
        end_at: end ? parseDate(end).toISOString() : null,
      };
      if (
        data.kind === "experiment" &&
        (!content.success_criteria.trim() ||
          (content.status === "completed" && !content.result.trim()))
      )
        throw new Error(
          "Укажите критерии успеха и результат завершённого эксперимента.",
        );
      await repo.save(data.kind, value, id, false, baseRevision);
      changed();
      router.back();
      setMessage(
        "Сохранено на устройстве. Предыдущая версия осталась в истории.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить. Проверьте поля.",
      );
    }
  }
  async function create(kind: string) {
    if (!data || !content) return;
    try {
      const value: KnowledgeContent = {
        title:
          kind === "experiment"
            ? "Проверка: " + content.title
            : "Предположение: " + content.title,
        description: "",
        status: "draft",
        confidence: 0,
        result: "",
        success_criteria: "",
        evidence: [{ id, revision: data.revision }],
        ...(kind === "experiment"
          ? {
              hypothesis_id: id,
              success_criteria: "Опишите критерии перед началом",
            }
          : {}),
      };
      const next = await repo.save(kind, value);
      changed();
      router.push(`/knowledge/${next}`);
    } catch {
      setMessage("Не удалось создать наблюдение.");
    }
  }
  async function evidence(ref: { id: string; revision: number }) {
    const target = await repo.get(ref.id);
    if (!target) {
      setMessage("Точная версия источника отсутствует в локальном архиве.");
      return;
    }
    Alert.alert(
      "Источник",
      `Вывод ссылается на ревизию ${ref.revision}. Текущая ревизия: ${target.revision}.${target.deleted_at ? " Источник удалён; доступна история." : ""}`,
      [
        { text: "Закрыть" },
        {
          text: "Открыть",
          onPress: () =>
            router.push(
              target.kind === "entry"
                ? `/entry/${target.id}`
                : `/knowledge/${target.id}`,
            ),
        },
        {
          text: "Исходная версия",
          onPress: () =>
            void repo
              .history(target.id)
              .then((rows) => {
                const source = rows.find((r) => r.revision === ref.revision);
                Alert.alert(
                  "Исходная версия",
                  String(
                    source?.content.text ??
                      source?.content.description ??
                      "Версия не найдена",
                  ),
                );
              })
              .catch(() =>
                setMessage("Эта версия отсутствует в локальном архиве."),
              ),
        },
      ],
    );
  }
  return (
    <Screen key={id} title="Наблюдение">
      {error && <ErrorState message={error} />}
      {!content || !data ? (
        <Skeleton />
      ) : (
        <>
          <Label muted>
            {data.source === "ai"
              ? "Интерпретация AI · требует вашей проверки"
              : "Наблюдение пользователя"}
          </Label>
          <Input
            accessibilityLabel="Формулировка"
            value={content.title}
            onChangeText={(v) => field("title", v)}
          />
          <Input
            accessibilityLabel="Описание"
            multiline
            value={content.description ?? ""}
            onChangeText={(v) => field("description", v)}
          />
          <Chips
            items={statuses.filter((s) => allowed[data.kind]?.includes(s.id))}
            value={content.status ?? "draft"}
            onChange={(v) => field("status", v)}
          />
          <Label muted>
            Уверенность модели: {Math.round((content.confidence ?? 0) * 100)}%.
            Это не вероятность доказанного факта.
          </Label>
          {content.alternatives?.map((a, i) => (
            <Label key={i} muted>
              Альтернативное объяснение: {a}
            </Label>
          ))}
          {data.kind !== "experiment" && (
            <>
              <Label>Выделенные наблюдения</Label>
              <Input
                accessibilityLabel="Выделенные наблюдения"
                multiline
                value={content.observations?.join("\n") ?? ""}
                onChangeText={(v) =>
                  field("observations", v.split("\n").filter(Boolean))
                }
              />
            </>
          )}
          {data.kind === "experiment" && (
            <>
              <Label>Начало · ДД.ММ.ГГГГ ЧЧ:ММ</Label>
              <Input
                accessibilityLabel="Начало эксперимента"
                value={start}
                onChangeText={setStart}
                placeholder="Не задано"
              />
              <Label>Окончание · ДД.ММ.ГГГГ ЧЧ:ММ</Label>
              <Input
                accessibilityLabel="Окончание эксперимента"
                value={end}
                onChangeText={setEnd}
                placeholder="Не задано"
              />
              <Label>Критерии успеха</Label>
              <Input
                accessibilityLabel="Критерии успеха"
                multiline
                value={content.success_criteria ?? ""}
                onChangeText={(v) => field("success_criteria", v)}
              />
              <Label>Результат</Label>
              <Input
                accessibilityLabel="Результат эксперимента"
                multiline
                value={content.result ?? ""}
                onChangeText={(v) => field("result", v)}
              />
              <Label>Наблюдения / измерения (по одному в строке)</Label>
              <Input
                accessibilityLabel="Измерения"
                multiline
                value={content.observations?.join("\n") ?? ""}
                onChangeText={(v) => field("observations", v.split("\n"))}
              />
            </>
          )}
          {content.questions?.map((q, i) => (
            <Label key={i}>{q}</Label>
          ))}
          <SyncBadge status={data.sync} />
          {message && <ErrorState message={message} />}
          <Button label="Сохранить исправления" onPress={() => void save()} />
          <Label>Почему появился этот вывод?</Label>
          {content.evidence.map((ref) => (
            <Button
              key={`${ref.id}/${ref.revision}`}
              secondary
              label={`Источник · версия ${ref.revision}`}
              onPress={() => void evidence(ref)}
            />
          ))}
          {data.kind === "pattern" && data.sync === "local" && (
            <Button
              secondary
              label="Создать гипотезу"
              onPress={() => void create("hypothesis")}
            />
          )}
          {data.kind === "hypothesis" && data.sync === "local" && (
            <>
              <Button
                secondary
                label="Создать эксперимент"
                onPress={() => void create("experiment")}
              />
              <Button
                secondary
                label="Запросить предложение эксперимента"
                onPress={() =>
                  Alert.alert(
                    "AI-предложение",
                    "Отправить эту гипотезу для подготовки эксперимента?",
                    [
                      { text: "Отмена" },
                      {
                        text: "Отправить",
                        onPress: () =>
                          void ai
                            .start("experiment_suggestion", [
                              { id, revision: data.revision },
                            ])
                            .then(() =>
                              setMessage("Предложение появится в Инсайтах."),
                            )
                            .catch(() =>
                              setMessage("Не удалось запросить предложение."),
                            ),
                      },
                    ],
                  )
                }
              />
            </>
          )}
          {data.kind === "experiment_suggestion" && (
            <Button
              secondary
              label="Принять предложение"
              onPress={() => {
                const hypothesis = content.evidence[0];
                void repo
                  .save("experiment", {
                    ...content,
                    status: "draft",
                    hypothesis_id: hypothesis.id,
                  })
                  .then((next) => {
                    changed();
                    router.push(`/knowledge/${next}`);
                  })
                  .catch(() => setMessage("Не удалось создать эксперимент."));
              }}
            />
          )}
          <Button
            secondary
            label="История версий"
            onPress={() =>
              void repo
                .history(id)
                .then(setRevisions)
                .catch(() =>
                  setMessage(
                    "История доступна после перехода на локальное хранение.",
                  ),
                )
            }
          />
          {revisions.map((r) => (
            <AppCard key={r.revision}>
              <Label>
                Версия {r.revision} · {r.source}
              </Label>
              <Label>{String(r.content.title)}</Label>
              <Label muted>{String(r.content.description)}</Label>
            </AppCard>
          ))}
        </>
      )}
    </Screen>
  );
}
