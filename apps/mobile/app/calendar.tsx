import { useState } from "react";
import { Pressable, View } from "react-native";
import { useLocal } from "../src/shared/provider";
import {
  Button,
  EmptyState,
  EntryCard,
  ErrorState,
  Label,
  Screen,
  Skeleton,
} from "../src/shared/ui";
import { theme as t } from "../src/shared/theme";
export default function Calendar() {
  const [month, setMonth] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [day, setDay] = useState(new Date().getDate());
  const { data, error } = useLocal((r) => r.all("entry"));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
    offset = (month.getDay() + 6) % 7;
  function shift(n: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
    setDay(1);
  }
  const onDay = (d: number) =>
    data?.filter(
      (e) =>
        new Date(String(e.content.occurred_at)).toDateString() ===
        new Date(month.getFullYear(), month.getMonth(), d).toDateString(),
    ) ?? [];
  return (
    <Screen title="Календарь">
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Button secondary label="Назад" onPress={() => shift(-1)} />
        <Button secondary label="Вперёд" onPress={() => shift(1)} />
      </View>
      <Label>
        {month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
      </Label>
      {error && <ErrorState message={error} />}
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
          <View
            key={d}
            style={{
              width: "14.28%",
              alignItems: "center",
              paddingVertical: 12,
            }}
          >
            <Label muted>{d}</Label>
          </View>
        ))}
        {Array.from({ length: offset + days }, (_, i) => {
          const n = i - offset + 1;
          return (
            <View key={i} style={{ width: "14.28%", minHeight: 48 }}>
              {n > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${n}, записей: ${onDay(n).length}`}
                  accessibilityState={{ selected: n === day }}
                  onPress={() => setDay(n)}
                  style={{
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: t.radius.sm,
                    backgroundColor:
                      n === day ? t.colors.accentSoft : t.colors.background,
                  }}
                >
                  <Label>{n}</Label>
                  {onDay(n).length > 0 && (
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: t.colors.accent,
                      }}
                    />
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
      <Label>
        {day} {month.toLocaleDateString("ru-RU", { month: "long" })}
      </Label>
      {!data ? (
        <Skeleton />
      ) : onDay(day).length ? (
        onDay(day).map((e) => <EntryCard key={e.id} entry={e} />)
      ) : (
        <EmptyState
          title="День без записей"
          description="Можно добавить наблюдение и выбрать дату события."
        />
      )}
    </Screen>
  );
}
