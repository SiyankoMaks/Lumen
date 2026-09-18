import { useState } from "react";
import { router } from "expo-router";
import { useLocal } from "../../src/shared/provider";
import {
  Chips,
  EmptyState,
  EntryCard,
  ErrorState,
  FAB,
  Screen,
  Skeleton,
} from "../../src/shared/ui";
export default function Entries() {
  const { data, error } = useLocal((r) => r.all("entry"));
  const [filter, setFilter] = useState("all");
  const rows = data?.filter(
    (e) => filter === "all" || e.content.type === filter,
  );
  return (
    <Screen title="Записи">
      <Chips
        items={[
          { id: "all", label: "Все" },
          { id: "note", label: "Заметки" },
          { id: "event", label: "События" },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {error && <ErrorState message={error} />}
      <FAB />
      {!rows ? (
        <Skeleton />
      ) : rows.length ? (
        rows.map((e) => <EntryCard key={e.id} entry={e} />)
      ) : (
        <EmptyState
          title="Здесь появятся ваши записи"
          description="Фиксируйте события и мысли в удобный момент."
          action={() => router.push("/entry/new")}
        />
      )}
    </Screen>
  );
}
