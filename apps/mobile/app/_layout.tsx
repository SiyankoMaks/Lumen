import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Provider } from "../src/shared/provider";
import { theme } from "../src/shared/theme";
export default function Root() {
  return (
    <SafeAreaProvider>
      <Provider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.background },
            headerTintColor: theme.colors.text,
            contentStyle: { backgroundColor: theme.colors.background },
            headerBackTitle: "Назад",
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="entry/[id]" options={{ title: "Запись" }} />
          <Stack.Screen
            name="knowledge/[id]"
            options={{ title: "Наблюдение" }}
          />
          <Stack.Screen name="calendar" options={{ title: "Календарь" }} />
          <Stack.Screen name="conflicts" options={{ title: "Конфликты" }} />
          <Stack.Screen name="auth" options={{ title: "Аккаунт" }} />
        </Stack>
      </Provider>
    </SafeAreaProvider>
  );
}
