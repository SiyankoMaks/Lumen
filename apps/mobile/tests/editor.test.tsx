import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { router } from "expo-router";
import Editor from "../app/entry/[id]";
const mockSave = jest.fn();
const mockSync = jest.fn();
jest.mock("../src/shared/provider", () => ({
  useLumen: () => ({
    repo: { save: mockSave },
    changed: jest.fn(),
    sync: mockSync,
    client: { tokens: null },
  }),
  useLocal: () => ({
    data: { entry: null, history: [], structures: [] },
    error: "",
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue("local-id");
});
test("saves locally before cloud completion and closes editor", async () => {
  mockSync.mockReturnValue(new Promise(() => {}));
  render(<Editor />);
  fireEvent.changeText(
    screen.getByLabelText("Текст записи"),
    "Вечерняя прогулка",
  );
  fireEvent.press(screen.getByRole("button", { name: "Готово" }));
  await waitFor(() =>
    expect(mockSave).toHaveBeenCalledWith(
      "entry",
      expect.objectContaining({ text: "Вечерняя прогулка" }),
      undefined,
      false,
      undefined,
    ),
  );
  await waitFor(() => expect(router.back).toHaveBeenCalled());
});
test("storage failure preserves text and stays in editor", async () => {
  mockSave.mockRejectedValue(new Error("Недостаточно места"));
  render(<Editor />);
  fireEvent.changeText(
    screen.getByLabelText("Текст записи"),
    "Не потерять эту мысль",
  );
  fireEvent.press(screen.getByRole("button", { name: "Готово" }));
  await screen.findByText("Недостаточно места");
  expect(screen.getByDisplayValue("Не потерять эту мысль")).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
});
