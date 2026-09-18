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
const mockAI = jest.fn();
jest.mock("../src/shared/provider", () => ({
  useLumen: () => ({
    repo: { save: mockSave },
    changed: jest.fn(),
    ai: { start: mockAI },
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
test("saves offline and closes editor without an AI request", async () => {
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
  expect(mockAI).not.toHaveBeenCalled();
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
