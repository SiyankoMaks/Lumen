import { useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useLumen, useLocal } from "../../src/shared/provider";
import {
  AppCard,
  Button,
  ErrorState,
  Input,
  Label,
  Screen,
} from "../../src/shared/ui";
export default function Profile() {
  const { client, repo, sync, signOut, deleteAccount } = useLumen();
  const { data } = useLocal(async (r) => ({
    queue: await r.queue(),
    conflicts: await r.conflicts(),
  }));
  const [message, setMessage] = useState(""),
    [deleting, setDeleting] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  async function exportData() {
    try {
      const local = await repo.export();
      let cloud: unknown = null;
      if (client.tokens) cloud = await client.request("/account/export");
      const file = new File(Paths.cache, "lumen-export.json");
      file.write(JSON.stringify({ format_version: 1, local, cloud }, null, 2));
      try {
        await Sharing.shareAsync(file.uri, { mimeType: "application/json" });
      } finally {
        file.delete();
      }
    } catch {
      setMessage("Экспорт не завершён. Проверьте соединение и повторите.");
    }
  }
  async function remove() {
    try {
      await deleteAccount(email, password);
      setDeleting(false);
      setPassword("");
      router.replace("/");
    } catch {
      setMessage(
        "Удаление не выполнено. Проверьте почту, пароль и соединение.",
      );
    }
  }
  return (
    <Screen title="Ваше пространство">
      <AppCard>
        <Label>
          {client.tokens ? "Аккаунт подключён" : "Локальный журнал"}
        </Label>
        <Label muted>
          {client.tokens
            ? "Записи синхронизируются с вашим аккаунтом."
            : "Можно писать без аккаунта и подключить облако позже."}
        </Label>
        {!client.tokens && (
          <Button
            label="Войти или зарегистрироваться"
            onPress={() => router.push("/auth")}
          />
        )}
        {client.tokens && (
          <Button
            secondary
            label="Войти заново"
            onPress={() => router.push("/auth")}
          />
        )}
      </AppCard>
      <AppCard>
        <Label>Синхронизация</Label>
        <Label muted>
          В очереди: {data?.queue.length ?? 0} · Конфликтов:{" "}
          {data?.conflicts.length ?? 0}
        </Label>
        <Button
          secondary
          label="Синхронизировать сейчас"
          onPress={() => void sync()}
        />
        <Button
          secondary
          label="Разрешить конфликты"
          onPress={() => router.push("/conflicts")}
        />
      </AppCard>
      <Button
        secondary
        label="Календарь"
        onPress={() => router.push("/calendar")}
      />
      <AppCard>
        <Label>AI и приватность</Label>
        <Label muted>
          Анализ запускается только по вашему запросу. Перед отправкой вы
          видите, какие данные будут переданы провайдеру. Выводы остаются
          предположениями, их можно исправлять.
        </Label>
        <Label muted>
          Тема: тёмная. Данные на устройстве хранятся в SQLite; ключи AI
          находятся только на сервере.
        </Label>
      </AppCard>
      <Button
        secondary
        label="Экспортировать данные"
        onPress={() => void exportData()}
      />
      {message && <ErrorState message={message} />}{" "}
      {client.tokens && (
        <>
          <Button
            secondary
            label="Выйти и очистить устройство"
            onPress={() =>
              Alert.alert(
                "Выйти из аккаунта?",
                `Локальные данные будут удалены. Несинхронизированных операций: ${data?.queue.length ?? 0}. При необходимости сначала экспортируйте данные.`,
                [
                  { text: "Отмена", style: "cancel" },
                  {
                    text: "Выйти",
                    style: "destructive",
                    onPress: () =>
                      void signOut().catch(() =>
                        setMessage(
                          "Не удалось выйти из облака. Проверьте соединение; локальные данные сохранены.",
                        ),
                      ),
                  },
                ],
              )
            }
          />
          <Button
            secondary
            label="Удалить аккаунт"
            onPress={() => setDeleting(!deleting)}
          />
          {deleting && (
            <AppCard>
              <Label>Удаление аккаунта и всех данных</Label>
              <Label muted>
                Подтвердите почту и пароль. Действие необратимо.
              </Label>
              <Input
                accessibilityLabel="Почта для удаления"
                placeholder="Почта"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <Input
                accessibilityLabel="Пароль для удаления"
                placeholder="Пароль"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <Button
                label="Подтвердить удаление"
                onPress={() =>
                  Alert.alert(
                    "Удалить все данные?",
                    "Серверные записи и локальный журнал будут удалены.",
                    [
                      { text: "Отмена" },
                      {
                        text: "Удалить",
                        style: "destructive",
                        onPress: () => void remove(),
                      },
                    ],
                  )
                }
              />
            </AppCard>
          )}
        </>
      )}
      <Label muted>Lumen 0.1 · Личное пространство наблюдений</Label>
    </Screen>
  );
}
