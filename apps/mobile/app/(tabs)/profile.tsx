import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Picker from "expo-document-picker";
import { useLumen, useLocal } from "../../src/shared/provider";
import { loadPolza, savePolza, clearPolza } from "../../src/ai/settings";
import { Polza, PolzaError, aiErrors } from "../../src/ai/polza";
import {
  AppCard,
  Button,
  ErrorState,
  Input,
  Label,
  Screen,
} from "../../src/shared/ui";
export default function Profile() {
  const { repo, ai, changed, clearData } = useLumen();
  const { data } = useLocal(async (r) => ({
    stats: await r.statistics(),
    conflicts: await r.conflicts(),
  }));
  const [apiKey, setKey] = useState(""),
    [model, setModel] = useState(""),
    [limit, setLimit] = useState("2048"),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [models, setModels] = useState<{ id: string; name: string }[]>([]),
    [search, setSearch] = useState("");
  useEffect(() => {
    void loadPolza()
      .then((c) => {
        if (c) {
          setKey(c.apiKey);
          setModel(c.model);
          setLimit(String(c.maxTokens));
          setSaved(true);
        }
      })
      .catch(() =>
        setMessage("Не удалось прочитать настройки ключа. Введите его заново."),
      );
  }, []);
  async function persist() {
    try {
      await savePolza({ apiKey, model, maxTokens: Number(limit) });
      setSaved(true);
      setMessage("Ключ и модель сохранены в защищённом хранилище телефона.");
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Не удалось сохранить настройки.",
      );
    }
  }
  async function catalog() {
    setBusy(true);
    const c = new AbortController(),
      timer = setTimeout(() => c.abort(), 20000);
    try {
      setModels(await new Polza().models(apiKey, c.signal));
      setMessage(
        "Каталог получен. Выберите модель, поддерживающую JSON schema, и сохраните настройки.",
      );
    } catch (e) {
      setMessage(
        e instanceof PolzaError
          ? aiErrors[e.code]
          : "Не удалось получить каталог.",
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  async function exportData() {
    try {
      const file = new File(Paths.cache, "lumen-backup.json");
      file.write(JSON.stringify(await repo.backup(), null, 2));
      try {
        await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
      } finally {
        file.delete();
      }
      setMessage(
        "Архив подготовлен. Убедитесь, что вы сохранили его в выбранное место. API-ключ в архив не входит.",
      );
    } catch {
      setMessage("Не удалось создать архив. Проверьте свободное место.");
    }
  }
  async function importData() {
    try {
      const picked = await Picker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const file = new File(picked.assets[0].uri);
      try {
        if (file.size > 50 * 1024 * 1024)
          throw new Error("Архив больше 50 МБ.");
        const n = await repo.restoreBackup(JSON.parse(await file.text()));
        changed();
        setMessage(
          `Архив проверен: ${n} записей. Существующие отличающиеся версии не перезаписываются.`,
        );
      } finally {
        file.delete();
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Импорт не выполнен.");
    }
  }
  return (
    <Screen title="Настройки">
      <AppCard>
        <Label>Ваш личный журнал</Label>
        <Label muted>
          Работает на телефоне без аккаунта Lumen и собственного сервера. В
          Polza отправляются только выбранные вами записи.
        </Label>
      </AppCard>
      <AppCard>
        <Label>Polza AI</Label>
        <Label muted>
          {saved
            ? "Ключ сохранён на этом телефоне."
            : "Добавьте ваш ключ Polza и выберите модель."}
        </Label>
        <Input
          accessibilityLabel="API-ключ Polza"
          placeholder="API-ключ Polza"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={apiKey}
          onChangeText={(v) => {
            setKey(v);
            setSaved(false);
          }}
        />
        <Input
          accessibilityLabel="ID модели Polza"
          placeholder="ID модели из каталога Polza"
          autoCapitalize="none"
          autoCorrect={false}
          value={model}
          onChangeText={(v) => {
            setModel(v);
            setSaved(false);
          }}
        />
        <Label muted>Лимит токенов ответа · 256–8192</Label>
        <Input
          accessibilityLabel="Лимит токенов"
          value={limit}
          onChangeText={(v) => {
            setLimit(v);
            setSaved(false);
          }}
          keyboardType="number-pad"
        />
        <Button label="Сохранить настройки AI" onPress={() => void persist()} />
        <Button
          secondary
          label="Проверить ключ и загрузить модели"
          disabled={busy || apiKey.length < 10}
          onPress={() => void catalog()}
        />
        {models.length > 0 && (
          <>
            <Input
              accessibilityLabel="Поиск модели"
              placeholder="Поиск в каталоге"
              value={search}
              onChangeText={setSearch}
            />
            {models
              .filter((m) =>
                `${m.name} ${m.id}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .slice(0, 15)
              .map((m) => (
                <Button
                  secondary
                  key={m.id}
                  label={`${m.name} · ${m.id}`}
                  onPress={() => {
                    setModel(m.id);
                    setSaved(false);
                  }}
                />
              ))}
          </>
        )}
        <Label muted>
          Запросы оплачиваются с вашего баланса Polza. Проверка каталога не
          запускает генерацию. Автоматических платных повторов нет.
        </Label>
        <Button
          secondary
          label="Удалить сохранённый ключ"
          onPress={() =>
            Alert.alert("Удалить ключ?", "Записи останутся на телефоне.", [
              { text: "Отмена" },
              {
                text: "Удалить",
                onPress: () =>
                  void ai
                    .cancel()
                    .then(() => clearPolza())
                    .then(() => {
                      setKey("");
                      setSaved(false);
                      setMessage("Ключ удалён.");
                    })
                    .catch(() => setMessage("Не удалось удалить ключ.")),
              },
            ])
          }
        />
      </AppCard>
      {message && <ErrorState message={message} />}
      <AppCard>
        <Label>Статистика приложения</Label>
        <Label>
          Записей: {data?.stats.entries ?? 0} · Наблюдений:{" "}
          {data?.stats.insights ?? 0}
        </Label>
        <Label>
          Запросов: {data?.stats.requests ?? 0} · Успешных:{" "}
          {data?.stats.completed ?? 0}
        </Label>
        <Label>Учтено токенов: {data?.stats.tokens ?? 0}</Label>
        <Label>
          Подтверждено Polza: {(data?.stats.cost_rub ?? 0).toFixed(4)} ₽
        </Label>
        {!!data?.stats.unknown && (
          <Label muted>
            Стоимость {data.stats.unknown} запросов не подтверждена. Итог может
            быть выше; проверьте баланс Polza.
          </Label>
        )}
      </AppCard>
      <Button
        secondary
        label="Экспортировать резервную копию"
        onPress={() => void exportData()}
      />
      <Button
        secondary
        label="Импортировать резервную копию"
        onPress={() => void importData()}
      />
      <Label muted>
        Архив содержит личные записи в читаемом JSON. Храните его в доверенном
        месте. Удаление приложения может удалить локальный журнал.
      </Label>
      <Button
        secondary
        label="Календарь"
        onPress={() => router.push("/calendar")}
      />
      {!!data?.conflicts.length && (
        <Button
          secondary
          label="Разобрать версии из старой синхронизации"
          onPress={() => router.push("/conflicts")}
        />
      )}
      <Button
        secondary
        label="Удалить все данные с телефона"
        onPress={() =>
          Alert.alert(
            "Удалить журнал и ключ?",
            "Это действие необратимо. Сначала сохраните резервную копию.",
            [
              { text: "Отмена", style: "cancel" },
              {
                text: "Удалить",
                style: "destructive",
                onPress: () =>
                  void clearData()
                    .then(() => {
                      setKey("");
                      setModel("");
                      setSaved(false);
                      router.replace("/");
                    })
                    .catch(() => setMessage("Не удалось очистить данные.")),
              },
            ],
          )
        }
      />
      <Label muted>Lumen 0.2 · Автономная версия</Label>
    </Screen>
  );
}
