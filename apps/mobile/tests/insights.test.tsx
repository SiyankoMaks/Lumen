import React from "react";
import { Alert } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import Insights from "../app/(tabs)/insights";
const mockStart = jest.fn().mockResolvedValue("job");
const mockEntities = [1, 2, 3].map((n) => ({
  id: `entry-${n}`,
  kind: "entry",
  revision: n,
  content: { text: "private note" },
}));
jest.mock("../src/shared/provider", () => ({
  useLumen: () => ({ ai: { start: mockStart } }),
  useLocal: () => ({ data: { entities: mockEntities, jobs: [] }, error: "" }),
}));

test("insights renders without bare native text and asks before sending private sources", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const view = render(<Insights />);
  function inspect(node: any, parent = "") {
    if (typeof node === "string" || typeof node === "number") {
      expect(["Text", "RCTText"]).toContain(parent);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((n) => inspect(n, parent));
      return;
    }
    if (node) inspect(node.children, node.type);
  }
  inspect(view.toJSON());
  fireEvent.press(screen.getByRole("button", { name: "Запросить анализ" }));
  expect(mockStart).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    "Анализ в Polza",
    expect.stringContaining("3"),
    expect.any(Array),
  );
  const buttons = alert.mock.calls[0][2]!;
  buttons.find((b) => b.text === "Отправить")!.onPress!();
  await waitFor(() =>
    expect(mockStart).toHaveBeenCalledWith(
      "pattern",
      [
        { id: "entry-1", revision: 1 },
        { id: "entry-2", revision: 2 },
        { id: "entry-3", revision: 3 },
      ],
      {},
    ),
  );
  alert.mockRestore();
});
