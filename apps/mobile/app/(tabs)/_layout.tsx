import { Tabs } from "expo-router";
import {
  House,
  BookOpen,
  Sparkles,
  Search,
  Settings,
} from "lucide-react-native";
import { theme as t } from "../../src/shared/theme";
export default function Layout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.accent,
        tabBarInactiveTintColor: t.colors.muted,
        tabBarStyle: {
          backgroundColor: t.colors.backgroundSecondary,
          borderTopColor: t.colors.border,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      {[
        { name: "index", title: "Сегодня", icon: House },
        { name: "entries", title: "Записи", icon: BookOpen },
        { name: "insights", title: "Инсайты", icon: Sparkles },
        { name: "search", title: "Поиск", icon: Search },
        { name: "profile", title: "Ещё", icon: Settings },
      ].map(({ name, title, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color }) => <Icon size={22} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
