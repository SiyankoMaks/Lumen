import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { AppState } from "react-native";
import * as SQLite from "expo-sqlite";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Repository } from "../db/repository";
import { Client } from "../api/client";
import { SyncEngine } from "../sync/engine";
import { ErrorState, Screen, Skeleton } from "./ui";

const queries = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const client = new Client();
type Context = {
  repo: Repository;
  client: Client;
  version: number;
  changed: () => void;
  sync: () => Promise<void>;
  online: boolean;
  notice: string;
  signOut: () => Promise<void>;
  deleteAccount: (email: string, password: string) => Promise<void>;
};
const State = createContext<Context | null>(null);
export function Provider({ children }: { children: React.ReactNode }) {
  const [repo, setRepo] = useState<Repository | null>(null),
    [version, setVersion] = useState(0),
    [online, setOnline] = useState(true),
    [notice, setNotice] = useState(""),
    [fatal, setFatal] = useState("");
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      await client.restore();
      const db = await SQLite.openDatabaseAsync("lumen.db");
      const repository = new Repository(db, Crypto.randomUUID);
      await repository.migrate();
      if (client.tokens) await repository.bindOwner(client.tokens.user_id);
      if (live) {
        setRepo(repository);
        setEngine(new SyncEngine(repository, client, changed));
      }
    })().catch(() =>
      setFatal(
        "Не удалось открыть локальную базу. Перезапустите приложение; данные не удалены.",
      ),
    );
    return () => {
      live = false;
    };
  }, [changed]);
  const sync = useCallback(async () => {
    if (!engine || !client.tokens) return;
    try {
      await engine.run();
      setNotice("");
    } catch {
      setNotice("Облако недоступно. Записи сохранены на устройстве.");
    }
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    void sync();
    const timer = setInterval(() => void sync(), 15000);
    const net = Network.addNetworkStateListener((state) => {
      setOnline(!!state.isConnected);
      if (state.isConnected) void sync();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      clearInterval(timer);
      net.remove();
      app.remove();
    };
  }, [engine, sync]);
  async function signOut() {
    await engine?.pause();
    try {
      if (client.tokens) await client.request("/auth/logout", "POST");
      await client.clear();
      await repo?.clear();
      queries.clear();
      changed();
    } finally {
      engine?.resume();
    }
  }
  async function deleteAccount(email: string, password: string) {
    await engine?.pause();
    try {
      await client.request("/account", "DELETE", { email, password });
      await client.clear();
      await repo?.clear();
      queries.clear();
      changed();
    } finally {
      engine?.resume();
    }
  }
  if (fatal)
    return (
      <Screen title="Lumen">
        <ErrorState message={fatal} />
      </Screen>
    );
  if (!repo)
    return (
      <Screen title="Lumen">
        <Skeleton />
      </Screen>
    );
  return (
    <QueryClientProvider client={queries}>
      <State.Provider
        value={{
          repo,
          client,
          version,
          changed,
          sync,
          online,
          notice,
          signOut,
          deleteAccount,
        }}
      >
        {children}
      </State.Provider>
    </QueryClientProvider>
  );
}
export function useLumen() {
  const value = useContext(State);
  if (!value) throw new Error("Provider missing");
  return value;
}
export function useLocal<T>(
  read: (repo: Repository) => Promise<T>,
  deps: unknown[] = [],
) {
  const { repo, version } = useLumen();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    read(repo)
      .then((value) => {
        if (live) {
          setData(value);
          setError("");
        }
      })
      .catch(() => {
        if (live)
          setError(
            "Не удалось прочитать данные. Попробуйте открыть экран снова.",
          );
      });
    return () => {
      live = false;
    };
  }, [repo, version, ...deps]);
  return { data, error };
}
