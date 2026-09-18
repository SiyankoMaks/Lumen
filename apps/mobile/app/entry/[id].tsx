import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { useLumen, useLocal } from "../../src/shared/provider";
import {
  Button,
  Chips,
  ErrorState,
  Input,
  Label,
  Screen,
  Skeleton,
  SyncBadge,
} from "../../src/shared/ui";
import type { EntryContent } from "../../src/db/repository";
import { displayDate, parseDate } from "../../src/shared/dates";
export default function Editor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const fresh = id === "new";
  const { repo, changed, ai } = useLumen();
  const { data, error } = useLocal(
    async (r) => ({
      entry: fresh ? null : await r.get(id),
      history: fresh ? [] : await r.history(id),
      structures: fresh
        ? []
        : (await r.all("structured_entry")).filter((s) =>
            (s.content.evidence as { id: string }[]).some((e) => e.id === id),
          ),
    }),
    [id],
  );
  const [text, setText] = useState(""),
    [type, setType] = useState("note"),
    [date, setDate] = useState(displayDate(new Date())),
    [tags, setTags] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [baseRevision, setBaseRevision] = useState<number | undefined>(undefined),
    [history, setHistory] = useState<unknown[]>([]);
  useEffect(() => {
    if (data && !loaded) {
      if (data.entry) {
        setBaseRevision(data.entry.revision);
        setText(String(data.entry.content.text ?? ""));
        setType(String(data.entry.content.type));
        setDate(displayDate(String(data.entry.content.occurred_at)));
        setTags(((data.entry.content.tags as string[]) ?? []).join(", "));
      }
      setLoaded(true);
    }
  }, [data, loaded]);
  async function save(deleted = false) {
    setBusy(true);
    try {
      const occurred = parseDate(date);
      if (!text.trim() || !Number.isFinite(occurred.getTime()))
        throw new Error("Введите текст и корректную дату.");
      await repo.save(
        "entry",
        {
          type: type as EntryContent["type"],
          text,
          occurred_at: occurred.toISOString(),
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          metadata: {},
        },
        fresh ? undefined : id,
        deleted,
        baseRevision,
      );
      changed();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Не удалось сохранить. Текст остался в редакторе.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function analyze() {
    try {
      if (!data?.entry) throw new Error("Сначала сохраните запись.");
      await ai.start("structured_entry", [
        { id, revision: data.entry.revision },
      ]);
      setMessage(
        "Анализ начат. Результат появится здесь после завершения. Оставьте приложение открытым.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Анализ недоступен");
    }
  }
  return (
    <Screen
      title={fresh ? "Новая запись" : "Ваша запись"}
      action={
        <Button label="Готово" disabled={busy} onPress={() => void save()} />
      }
    >
      {error && <ErrorState message={error} />}{" "}
      {!data ? (
        <Skeleton />
      ) : (
        <>
          <Input
            accessibilityLabel="Текст записи"
            placeholder="Что у вас на уме?"
            multiline
            value={text}
            onChangeText={setText}
            style={{ minHeight: 250 }}
          />
          <Chips
            items={[
              { id: "note", label: "Заметка" },
              { id: "event", label: "Событие" },
            ]}
            value={type}
            onChange={setType}
          />
          <Label muted>Дата события · ДД.ММ.ГГГГ ЧЧ:ММ</Label>
          <Input
            accessibilityLabel="Дата события"
            value={date}
            onChangeText={setDate}
          />
          <Input
            accessibilityLabel="Теги через запятую"
            placeholder="Теги через запятую"
            value={tags}
            onChangeText={setTags}
          />
          {data.entry && <SyncBadge status={data.entry.sync} />}{" "}
          {message && <ErrorState message={message} />}{" "}
          {!fresh && (
            <>
              <Button
                secondary
                label="Структурировать с AI"
                onPress={() =>
                  Alert.alert(
                    "Анализ записи",
                    "Текст сохранённой версии этой записи будет отправлен в Polza. Запрос оплачивается с вашего баланса. Результат можно исправить или отклонить.",
                    [
                      { text: "Отмена", style: "cancel" },
                      { text: "Отправить", onPress: () => void analyze() },
                    ],
                  )
                }
              />
              {data.structures.map((s) => (
                <Button
                  key={s.id}
                  secondary
                  label={String(s.content.title)}
                  onPress={() => router.push(`/knowledge/${s.id}`)}
                />
              ))}
              {data.entry?.sync === "conflict" && (
                <Button
                  label="Разрешить конфликт"
                  onPress={() => router.push("/conflicts")}
                />
              )}
              <Button
                secondary
                label="История изменений"
                onPress={() => {
                  setHistory(data.history);
                }}
              />
              {history.map((h: any, i) => (
                <View key={i}>
                  <Label muted>
                    Версия {h.revision} · {h.source}
                  </Label>
                  <Label>{h.content.text}</Label>
                </View>
              ))}
              <Button
                secondary
                label="Удалить запись"
                onPress={() =>
                  Alert.alert(
                    "Удалить запись?",
                    "Запись исчезнет из журнала. Её история останется в локальной базе.",
                    [
                      { text: "Отмена", style: "cancel" },
                      {
                        text: "Удалить",
                        style: "destructive",
                        onPress: () => void save(true),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}
