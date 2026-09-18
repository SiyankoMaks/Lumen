import * as SecureStore from "expo-secure-store";
import type { PolzaConfig } from "./polza";
const KEY = "lumen.polza.credentials.v1";
const options = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export async function loadPolza(): Promise<PolzaConfig | null> {
  const value = await SecureStore.getItemAsync(KEY);
  if (!value) return null;
  const result = JSON.parse(value);
  return validateConfig(result);
}
export function validateConfig(config: PolzaConfig): PolzaConfig {
  const key = config.apiKey.trim(),
    model = config.model.trim();
  if (key.length < 10 || key.length > 2048 || /[\r\n]/.test(key))
    throw new Error("Введите корректный API-ключ Polza.");
  if (!model || model.length > 200 || /[\r\n]/.test(model))
    throw new Error("Укажите ID модели из каталога Polza.");
  if (
    !Number.isInteger(config.maxTokens) ||
    config.maxTokens < 256 ||
    config.maxTokens > 8192
  )
    throw new Error("Лимит ответа — от 256 до 8192 токенов.");
  return { apiKey: key, model, maxTokens: config.maxTokens };
}
export async function savePolza(config: PolzaConfig) {
  await SecureStore.setItemAsync(
    KEY,
    JSON.stringify(validateConfig(config)),
    options,
  );
}
export async function clearPolza() {
  await SecureStore.deleteItemAsync(KEY);
}
