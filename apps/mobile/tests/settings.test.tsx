import * as SecureStore from "expo-secure-store";
import { savePolza, loadPolza, clearPolza } from "../src/ai/settings";

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

test("credentials use device-only secure storage and can be removed", async () => {
  const config = {
    apiKey: "test-personal-key",
    model: "test/model",
    maxTokens: 1024,
  };
  await savePolza(config);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "lumen.polza.credentials.v1",
    JSON.stringify(config),
    { keychainAccessible: "device-only" },
  );
  jest
    .mocked(SecureStore.getItemAsync)
    .mockResolvedValue(JSON.stringify(config));
  expect(await loadPolza()).toEqual(config);
  await clearPolza();
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
    "lumen.polza.credentials.v1",
  );
});

test("invalid credentials never reach storage and errors do not echo the secret", async () => {
  jest.clearAllMocks();
  await expect(
    savePolza({
      apiKey: "private\nsecret",
      model: "test/model",
      maxTokens: 1024,
    }),
  ).rejects.toThrow("Введите корректный API-ключ Polza.");
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
