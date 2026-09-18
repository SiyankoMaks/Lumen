import { useState } from "react";
import { VersionText } from "../src/shared/VersionText";
import { useLumen, useLocal } from "../src/shared/provider";
import {
  AppCard,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Label,
  Screen,
  Skeleton,
} from "../src/shared/ui";
import type {
  Entity,
  EntryContent,
  KnowledgeContent,
  LocalConflict,
  LocalEntity,
} from "../src/db/repository";
function Versions({
  conflict,
  local,
}: {
  conflict: LocalConflict;
  local: LocalEntity | null;
}) {
  const { repo, changed } = useLumen();
  const server: Entity = JSON.parse(conflict.server_snapshot);
  const current = local ?? JSON.parse(conflict.local_snapshot);
  const [text, setText] = useState(
      String(current.content.text ?? current.content.description ?? ""),
    ),
    [error, setError] = useState("");
  async function resolve(choice: Entity, merge = false) {
    try {
      const content = merge
        ? {
            ...current.content,
            [current.kind === "entry" ? "text" : "description"]: text,
          }
        : choice.content;
      await repo.resolve(
        conflict,
        content as EntryContent | KnowledgeContent,
        !!choice.deleted_at,
      );
      changed();
    } catch {
      setError("Не удалось сохранить решение. Обе версии сохранены.");
    }
  }
  return (
    <AppCard>
      <Label>Есть две версии записи</Label>
      <Label muted>
        Версия на устройстве{current.deleted_at ? " · удалена" : ""}
      </Label>
      <VersionText
        value={String(current.content.text ?? current.content.description)}
        other={String(server.content.text ?? server.content.description)}
      />
      <Label muted>
        Архивная серверная версия · ревизия {server.revision}
        {server.deleted_at ? " · удалена" : ""}
      </Label>
      <VersionText
        value={String(server.content.text ?? server.content.description)}
        other={String(current.content.text ?? current.content.description)}
      />
      {error && <ErrorState message={error} />}
      <Button
        label="Использовать локальную"
        onPress={() => void resolve(current)}
      />
      <Button
        secondary
        label="Использовать архивную серверную"
        onPress={() => void resolve(server)}
      />
      <Label>Объединить вручную</Label>
      <Input
        accessibilityLabel="Объединённая версия"
        multiline
        value={text}
        onChangeText={setText}
      />
      <Button
        secondary
        label="Создать новую ревизию"
        onPress={() => void resolve({ ...current, deleted_at: null }, true)}
      />
    </AppCard>
  );
}
export default function Conflicts() {
  const { data, error } = useLocal(async (r) =>
    Promise.all(
      (await r.conflicts()).map(async (c) => ({
        c,
        local: await r.get(c.entity_id),
      })),
    ),
  );
  return (
    <Screen title="Конфликты">
      {error && <ErrorState message={error} />}
      {!data ? (
        <Skeleton />
      ) : data.length ? (
        data.map(({ c, local }) => (
          <Versions key={c.id} conflict={c} local={local} />
        ))
      ) : (
        <EmptyState
          title="Конфликтов нет"
          description="Если появятся две версии, здесь можно выбрать или объединить их."
        />
      )}
    </Screen>
  );
}
