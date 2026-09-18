import { useState } from "react";
import { router } from "expo-router";
import { useLumen } from "../src/shared/provider";
import { Button, ErrorState, Input, Label, Screen } from "../src/shared/ui";
export default function Auth() {
  const { client, repo, changed, sync } = useLumen();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [register, setRegister] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await client.authenticate(email.trim(), password, register, (id) =>
        repo.bindOwner(id),
      );
      changed();
      void sync();
      router.back();
    } catch {
      setMessage(
        "Не удалось войти. Проверьте почту, пароль и соединение. Для нового аккаунта пароль должен содержать от 10 символов.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen title={register ? "Создать аккаунт" : "С возвращением"}>
      <Label muted>
        Аккаунт подключает синхронизацию и анализ. Локальные записи будут
        добавлены в этот аккаунт.
      </Label>
      <Input
        accessibilityLabel="Электронная почта"
        placeholder="Почта"
        keyboardType="email-address"
        autoCapitalize="none"
        value={email}
        onChangeText={setEmail}
      />
      <Input
        accessibilityLabel="Пароль"
        placeholder="Пароль, от 10 символов"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {message && <ErrorState message={message} />}
      <Button
        label={register ? "Зарегистрироваться" : "Войти"}
        disabled={busy}
        onPress={() => void submit()}
      />
      <Button
        secondary
        label={register ? "Уже есть аккаунт" : "Создать аккаунт"}
        onPress={() => setRegister(!register)}
      />
    </Screen>
  );
}
