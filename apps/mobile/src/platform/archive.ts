import { Directory } from "expo-file-system";

// Persist through Android's document picker instead of deleting a shared cache URI.
export async function saveArchive(snapshot: unknown) {
  const directory = await Directory.pickDirectoryAsync();
  const file = directory.createFile(
    `lumen-backup-${Date.now()}.json`,
    "application/json",
  );
  try {
    file.write(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    try {
      file.delete();
    } catch {
      /* Preserve the original write error. */
    }
    throw error;
  }
}
