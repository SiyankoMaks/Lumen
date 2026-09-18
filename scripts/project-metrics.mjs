import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const unique = [...new Set(files)];
const areas = {
  mobile: { files: 0, lines: 0 },
  backend: { files: 0, lines: 0 },
  tests: { files: 0, lines: 0 },
  documentation: { files: 0, lines: 0 },
};
for (const path of unique) {
  let area = path.includes("/tests/")
    ? "tests"
    : path.startsWith("apps/mobile/")
      ? "mobile"
      : path.startsWith("services/api/")
        ? "backend"
        : path.endsWith(".md")
          ? "documentation"
          : null;
  if (!area || !/\.(tsx?|py|md|ya?ml|cjs)$/.test(path)) continue;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  areas[area].files++;
  areas[area].lines += text.split("\n").length - Number(text.endsWith("\n"));
}
const result = {
  generated_at: new Date().toISOString(),
  basis_commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  commit_count: Number(
    execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }),
  ),
  tracked_and_pending_files: unique.length,
  areas,
  note: "Counts describe source files at generation time, not quality or test pass status. Test evidence is in docs/WORK_LOG.md. Baseline includes historical optional backend.",
};
writeFileSync("docs/metrics.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
