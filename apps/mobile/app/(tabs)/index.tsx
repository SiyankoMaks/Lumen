import { View, Text } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { CalendarDays, Feather } from "lucide-react-native";
import { useLocal, useLumen } from "../../src/shared/provider";
import {
  AppCard,
  Button,
  EmptyState,
  EntryCard,
  ErrorState,
  IconButton,
  Label,
  Screen,
  Skeleton,
} from "../../src/shared/ui";
import { theme as t } from "../../src/shared/theme";
export default function Today() {
  const { data: entries, error } = useLocal((r) => r.all("entry"));
  const { online, notice } = useLumen();
  const week = (entries ?? []).filter(
    (e) =>
      new Date(String(e.content.occurred_at)).getTime() >
      Date.now() - 7 * 86400000,
  );
  return (
    <Screen
      title="Lumen"
      action={
        <IconButton label="Календарь" onPress={() => router.push("/calendar")}>
          <CalendarDays color={t.colors.muted} />
        </IconButton>
      }
    >
      <LinearGradient
        colors={[
          t.colors.elevated,
          t.colors.backgroundSecondary,
          t.colors.background,
        ]}
        style={{
          padding: t.spacing.xxl,
          borderRadius: t.radius.xl,
          gap: t.spacing.xl,
          minHeight: 240,
          justifyContent: "center",
        }}
      >
        <Feather color={t.colors.accent} size={32} />
        <Text
          accessibilityRole="header"
          style={{
            fontSize: t.font.hero,
            color: t.colors.text,
            fontWeight: "600",
          }}
        >
          Внимание к себе{"\n"}начинается здесь.
        </Text>
        <Label muted>
          Сохраните мысль. Заметьте повторение.{"\n"}Проверьте своё
          предположение.
        </Label>
      </LinearGradient>
      <Button label="Новая запись" onPress={() => router.push("/entry/new")} />
      {(!online || notice) && (
        <ErrorState
          message={notice || "Нет соединения. Можно продолжать писать."}
        />
      )}
      {error && <ErrorState message={error} />}
      <AppCard>
        <Label size={t.font.section}>Ваша неделя</Label>
        <Text style={{ fontSize: 40, color: t.colors.accent }}>
          {week.length}
        </Text>
        <Label muted>записей за последние 7 дней</Label>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {Array.from({ length: 7 }, (_, i) => {
            const date = new Date(Date.now() - (6 - i) * 86400000);
            const active = week.some(
              (e) =>
                new Date(String(e.content.occurred_at)).toDateString() ===
                date.toDateString(),
            );
            return (
              <View key={i} style={{ alignItems: "center", gap: 8 }}>
                <View
                  accessibilityLabel={active ? "Есть записи" : "Нет записей"}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: active ? t.colors.accent : t.colors.dim,
                  }}
                />
                <Label muted size={12}>
                  {date.toLocaleDateString("ru-RU", { weekday: "short" })}
                </Label>
              </View>
            );
          })}
        </View>
      </AppCard>
      <Label size={t.font.section}>Последние записи</Label>
      {!entries ? (
        <Skeleton />
      ) : entries.length ? (
        entries.slice(0, 3).map((e) => <EntryCard key={e.id} entry={e} />)
      ) : (
        <EmptyState
          title="Место для первой мысли"
          description="Записи сохраняются на устройстве, даже без интернета."
          action={() => router.push("/entry/new")}
        />
      )}
      <Button
        secondary
        label="Открыть наблюдения"
        onPress={() => router.push("/insights")}
      />
    </Screen>
  );
}
