import { Text } from "react-native";
import { theme as t } from "./theme";
// Highlight the changed span in linear time, even for long journal entries.
export function VersionText({
  value,
  other,
}: {
  value: string;
  other: string;
}) {
  let start = 0,
    end = 0;
  while (
    start < Math.min(value.length, other.length) &&
    value[start] === other[start]
  )
    start++;
  while (
    end < Math.min(value.length, other.length) - start &&
    value[value.length - end - 1] === other[other.length - end - 1]
  )
    end++;
  return (
    <Text
      style={{ color: t.colors.text, fontSize: t.font.body, lineHeight: 25 }}
    >
      {value.slice(0, start)}
      <Text
        style={{ backgroundColor: t.colors.accentSoft, color: t.colors.accent }}
      >
        {value.slice(start, value.length - end)}
      </Text>
      {end ? value.slice(-end) : ""}
    </Text>
  );
}
