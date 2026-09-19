import { Directory } from "expo-file-system";
import { saveArchive } from "../src/platform/archive";
jest.mock("expo-file-system", () => ({
  Directory: { pickDirectoryAsync: jest.fn() },
}));

test("export remains readable after completion and uses the user-selected folder", async () => {
  let contents = "";
  const remove = jest.fn(() => {
    contents = "";
  });
  const create = jest.fn(() => ({
    write: (value: string) => {
      contents = value;
    },
    delete: remove,
  }));
  jest
    .mocked(Directory.pickDirectoryAsync)
    .mockResolvedValue({ createFile: create } as any);
  const snapshot = {
    format: "lumen-standalone",
    entities: [{ text: "private journal" }],
  };
  await saveArchive(snapshot);
  expect(create).toHaveBeenCalledWith(
    expect.stringMatching(/^lumen-backup-\d+\.json$/),
    "application/json",
  );
  expect(JSON.parse(contents)).toEqual(snapshot);
  expect(remove).not.toHaveBeenCalled();
});

test("failed write removes its incomplete archive; cancellation creates no file", async () => {
  const remove = jest.fn();
  const create = jest.fn(() => ({
    write: () => {
      throw new Error("disk full");
    },
    delete: remove,
  }));
  jest
    .mocked(Directory.pickDirectoryAsync)
    .mockResolvedValue({ createFile: create } as any);
  await expect(saveArchive({})).rejects.toThrow("disk full");
  expect(remove).toHaveBeenCalledTimes(1);
  create.mockClear();
  jest
    .mocked(Directory.pickDirectoryAsync)
    .mockRejectedValue(new Error("cancelled"));
  await expect(saveArchive({})).rejects.toThrow("cancelled");
  expect(create).not.toHaveBeenCalled();
});
