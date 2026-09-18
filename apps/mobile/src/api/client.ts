import * as SecureStore from "expo-secure-store";
import type { components } from "../../../../packages/api-client/schema";
import { ApiError, type Transport } from "../sync/engine";
type Tokens = components["schemas"]["Tokens"];
const base = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
export class Client implements Transport {
  tokens: Tokens | null = null;
  private refreshPromise: Promise<void> | null = null;
  private epoch = 0;
  async restore() {
    const value = await SecureStore.getItemAsync("lumen.session");
    this.tokens = value ? JSON.parse(value) : null;
  }
  async persist(tokens: Tokens) {
    await SecureStore.setItemAsync("lumen.session", JSON.stringify(tokens));
    this.tokens = tokens;
  }
  async clear() {
    this.epoch += 1;
    this.tokens = null;
    await SecureStore.deleteItemAsync("lumen.session");
  }
  async authenticate(
    email: string,
    password: string,
    register: boolean,
    bindOwner: (id: string) => Promise<void>,
  ) {
    const tokens = await this.send<Tokens>(
      register ? "/auth/register" : "/auth/login",
      "POST",
      { email, password },
      false,
    );
    await bindOwner(tokens.user_id);
    await this.persist(tokens);
    return tokens;
  }
  private async send<T>(
    path: string,
    method: string,
    body: unknown,
    authorized = true,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(authorized && this.tokens
            ? { Authorization: `Bearer ${this.tokens.access_token}` }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new ApiError(response.status, data);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    try {
      return await this.send<T>(path, method, body);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !this.tokens)
        throw error;
      if (!this.refreshPromise) {
        const epoch = this.epoch;
        this.refreshPromise = this.send<Tokens>(
          "/auth/refresh",
          "POST",
          { refresh_token: this.tokens.refresh_token },
          false,
        )
          .then((t) => {
            if (epoch !== this.epoch) throw new Error("Session ended");
            return this.persist(t);
          })
          .finally(() => {
            this.refreshPromise = null;
          });
      }
      await this.refreshPromise;
      return this.send<T>(path, method, body);
    }
  }
}
