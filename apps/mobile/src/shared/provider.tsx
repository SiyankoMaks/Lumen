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
import { LocalRepository } from "../db/local";
import { AIService } from "../ai/service";
import { loadPolza, clearDeviceSecrets } from "../ai/settings";
import { ErrorState, Screen, Skeleton } from "./ui";
type Context = {
  repo: LocalRepository;
  ai: AIService;
  version: number;
  changed: () => void;
  online: boolean;
  notice: string;
  clearData: () => Promise<void>;
};
const State = createContext<Context | null>(null);
// Single open/migration even under React's development effect replay.
let opening: Promise<LocalRepository> | null = null;
function open() {
  return (opening ??= (async () => {
    const db = await SQLite.openDatabaseAsync("lumen.db");
    const repo = new LocalRepository(db, Crypto.randomUUID);
    await repo.migrate();
    return repo;
  })().catch((e) => {
    opening = null;
    throw e;
  }));
}
export function Provider({ children }: { children: React.ReactNode }) {
  const [repo, setRepo] = useState<LocalRepository | null>(null),
    [ai, setAI] = useState<AIService | null>(null),
    [version, setVersion] = useState(0),
    [online, setOnline] = useState(true),
    [fatal, setFatal] = useState("");
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    void open()
      .then((r) => {
        if (live) {
          setRepo(r);
          setAI(new AIService(r, loadPolza, undefined, changed));
        }
      })
      .catch(() =>
        setFatal(
          "Не удалось открыть локальную базу. Данные не удалены; перезапустите приложение.",
        ),
      );
    return () => {
      live = false;
    };
  }, [changed]);
  useEffect(() => {
    void Network.getNetworkStateAsync()
      .then((n) => setOnline(!!n.isConnected))
      .catch(() => setOnline(false));
    const net = Network.addNetworkStateListener((n) =>
      setOnline(!!n.isConnected),
    );
    const app = AppState.addEventListener("change", (state) => {
      if (state === "background") void ai?.cancel();
    });
    return () => {
      net.remove();
      app.remove();
    };
  }, [ai]);
  async function clearData() {
    await ai?.cancel();
    await ai?.idle();
    await repo?.clear();
    await clearDeviceSecrets();
    changed();
  }
  if (fatal)
    return (
      <Screen title="Lumen">
        <ErrorState message={fatal} />
      </Screen>
    );
  if (!repo || !ai)
    return (
      <Screen title="Lumen">
        <Skeleton />
      </Screen>
    );
  return (
    <State.Provider
      value={{
        repo,
        ai,
        version,
        changed,
        online,
        notice:
          ai.failure ||
          (online
            ? ""
            : "Нет интернета. Записи сохраняются локально; AI будет доступен после подключения."),
        clearData,
      }}
    >
      {children}
    </State.Provider>
  );
}
export function useLumen() {
  const value = useContext(State);
  if (!value) throw new Error("Provider missing");
  return value;
}
export function useLocal<T>(
  read: (repo: LocalRepository) => Promise<T>,
  deps: unknown[] = [],
) {
  const { repo, version } = useLumen();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    read(repo)
      .then((value) => {
        if (live) {
          setData(value);
          setError("");
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setError("Не удалось прочитать данные. Откройте экран снова.");
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [repo, version, ...deps]);
  return { data, error, loading };
}
