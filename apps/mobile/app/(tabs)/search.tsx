import { useState } from "react";
import { useLocal } from "../../src/shared/provider";
import {
  EmptyState,
  EntryCard,
  ErrorState,
  Input,
  Label,
  Screen,
  Skeleton,
} from "../../src/shared/ui";
export default function Search() {
  const [query, setQuery] = useState("");
  const { data, error } = useLocal((r) => r.all("entry"));
  const matches = data?.filter((e) =>
    `${e.content.text ?? ""} ${((e.content.tags as string[]) ?? []).join(" ")}`
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru")),
  );
  return (
    <Screen title="Поиск">
      <Input
        accessibilityLabel="Поиск по записям"
        placeholder="Найти слова, идеи, моменты…"
        value={query}
        onChangeText={setQuery}
      />
      <Label muted>Поиск по тексту и тегам на этом устройстве.</Label>
      {error && <ErrorState message={error} />}{" "}
      {!data ? (
        <Skeleton />
      ) : !query.trim() ? (
        <EmptyState
          title="Что хочется вспомнить?"
          description="Введите слово из записи, например «прогулка» или «проект»."
        />
      ) : matches?.length ? (
        matches.map((e) => <EntryCard key={e.id} entry={e} />)
      ) : (
        <EmptyState
          title="Совпадений нет"
          description="Попробуйте другое слово или его часть."
        />
      )}
    </Screen>
  );
}
