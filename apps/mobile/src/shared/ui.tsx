import React from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronRight,
  CloudCheck,
  CloudOff,
  Plus,
  TriangleAlert,
} from "lucide-react-native";
import { router } from "expo-router";
import { theme as t } from "./theme";
import type { LocalEntity } from "../db/repository";

export function Label({
  children,
  muted = false,
  size = t.font.body,
}: {
  children: React.ReactNode;
  muted?: boolean;
  size?: number;
}) {
  return (
    <Text
      style={{
        color: muted ? t.colors.muted : t.colors.text,
        fontSize: size,
        lineHeight: size * 1.5,
      }}
    >
      {children}
    </Text>
  );
}
export function Heading({ children }: { children: React.ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
export function Screen({
  children,
  title,
  action,
}: {
  children: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.screen}
        >
          <View style={styles.top}>
            <Heading>{title}</Heading>
            {action}
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function AppCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? t.colors.elevated : t.colors.accent,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text
        style={{
          color: secondary ? t.colors.text : t.colors.inverse,
          fontSize: t.font.body,
          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.icon}
    >
      {children}
    </Pressable>
  );
}
export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={t.colors.muted}
      {...props}
      style={[
        styles.input,
        props.multiline ? { minHeight: 150, textAlignVertical: "top" } : null,
        props.style,
      ]}
    />
  );
}
export function Chips({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: t.spacing.sm }}
    >
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.id }}
          onPress={() => onChange(item.id)}
          style={[
            styles.chip,
            {
              backgroundColor:
                value === item.id ? t.colors.accentSoft : t.colors.surface,
            },
          ]}
        >
          <Text
            style={{
              color: value === item.id ? t.colors.accent : t.colors.muted,
              fontSize: t.font.secondary,
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
const syncLabels: Record<string, string> = {
  local: "Сохранено на телефоне",
  synced: "Синхронизировано",
  pending: "Сохранено на устройстве",
  conflict: "Есть две версии",
  failed_retryable: "Ожидает соединения",
  blocked: "Нужно исправить данные",
};
export function SyncBadge({ status }: { status: string }) {
  const Icon =
    status === "synced" || status === "local"
      ? CloudCheck
      : status === "conflict" || status === "blocked"
        ? TriangleAlert
        : CloudOff;
  return (
    <View style={styles.row}>
      <Icon
        size={15}
        color={status === "conflict" ? t.colors.warning : t.colors.muted}
      />
      <Label muted size={t.font.caption}>
        {syncLabels[status] ?? status}
      </Label>
    </View>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: () => void;
}) {
  return (
    <AppCard>
      <Label size={t.font.section}>{title}</Label>
      <Label muted>{description}</Label>
      {action && <Button label="Создать запись" onPress={action} />}
    </AppCard>
  );
}
export function ErrorState({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.card}>
      <Text style={{ color: t.colors.warning, fontSize: t.font.secondary }}>
        {message}
      </Text>
    </View>
  );
}
export function Skeleton() {
  return (
    <View
      accessibilityLabel="Загрузка"
      style={[styles.card, { height: 110, justifyContent: "center" }]}
    >
      <ActivityIndicator color={t.colors.accent} />
    </View>
  );
}
export function EntryCard({ entry }: { entry: LocalEntity }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть запись: ${String(entry.content.text ?? "Событие").slice(0, 80)}`}
      onPress={() => router.push(`/entry/${entry.id}`)}
      style={styles.entry}
    >
      <View style={{ flex: 1, gap: t.spacing.sm }}>
        <Text numberOfLines={2} style={styles.body}>
          {String(entry.content.text ?? "Событие")}
        </Text>
        <Label muted size={t.font.caption}>
          {new Date(String(entry.content.occurred_at)).toLocaleString("ru-RU", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Label>
        <SyncBadge status={entry.sync} />
      </View>
      <ChevronRight color={t.colors.dim} size={18} />
    </Pressable>
  );
}
export function FAB() {
  return (
    <Pressable
      accessibilityLabel="Новая запись"
      accessibilityRole="button"
      style={styles.fab}
      onPress={() => router.push("/entry/new")}
    >
      <Plus color={t.colors.text} size={26} />
    </Pressable>
  );
}
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: t.colors.background },
  screen: {
    padding: t.spacing.xl,
    gap: t.spacing.xl,
    paddingBottom: t.spacing.hero,
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
  },
  heading: {
    fontSize: t.font.title,
    fontWeight: "600",
    color: t.colors.text,
    flexShrink: 1,
  },
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: t.spacing.xl,
    gap: t.spacing.md,
  },
  button: {
    minHeight: 48,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    justifyContent: "center",
  },
  icon: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.border,
    color: t.colors.text,
    padding: t.spacing.lg,
    fontSize: t.font.body,
    minHeight: 48,
  },
  chip: {
    paddingHorizontal: t.spacing.lg,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: t.radius.pill,
  },
  row: { flexDirection: "row", gap: t.spacing.sm, alignItems: "center" },
  entry: {
    flexDirection: "row",
    gap: t.spacing.lg,
    alignItems: "center",
    paddingVertical: t.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
  },
  body: { fontSize: t.font.body, lineHeight: 25, color: t.colors.text },
  fab: {
    alignSelf: "flex-end",
    backgroundColor: t.colors.violetSoft,
    borderColor: t.colors.violet,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
});
