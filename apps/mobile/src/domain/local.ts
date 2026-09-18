import { z } from "zod";
export const kindSchema = z.enum([
  "entry",
  "structured_entry",
  "pattern",
  "hypothesis",
  "experiment",
  "experiment_suggestion",
  "weekly_review",
]);
export type Kind = z.infer<typeof kindSchema>;
export type AIKind = Exclude<Kind, "entry" | "experiment">;
export const refSchema = z
  .object({ id: z.uuid(), revision: z.number().int().positive() })
  .strict();
export const entrySchema = z
  .object({
    type: z.enum(["note", "event"]).default("note"),
    text: z.string().max(50000).nullable().default(null),
    occurred_at: z.iso.datetime({ offset: true }),
    tags: z.array(z.string().max(100)).max(30).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()
  .refine(
    (v) => !!v.text?.trim() || Object.keys(v.metadata).length > 0,
    "Введите текст записи.",
  );
export const knowledgeSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(""),
    status: z
      .enum([
        "draft",
        "active",
        "supported",
        "weakened",
        "rejected",
        "archived",
        "completed",
        "cancelled",
      ])
      .default("draft"),
    confidence: z.number().min(0).max(1).default(0),
    evidence: z.array(refSchema).min(1).max(100),
    alternatives: z.array(z.string().max(3000)).max(20).default([]),
    hypothesis_id: z.uuid().nullable().default(null),
    start_at: z.iso.datetime({ offset: true }).nullable().default(null),
    end_at: z.iso.datetime({ offset: true }).nullable().default(null),
    success_criteria: z.string().max(5000).default(""),
    result: z.string().max(10000).default(""),
    observations: z.array(z.string().max(5000)).max(100).default([]),
    questions: z.array(z.string().max(3000)).max(20).default([]),
  })
  .strict();
export const resultSchema = z
  .object({ items: z.array(knowledgeSchema).max(20) })
  .strict();
export const entitySchema = z
  .object({
    id: z.uuid(),
    kind: kindSchema,
    content: z.record(z.string(), z.unknown()),
    revision: z.number().int().positive(),
    source: z.enum(["user", "ai", "system"]),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    deleted_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export const backupSchema = z
  .object({
    format: z.literal("lumen-standalone"),
    version: z.literal(2),
    exported_at: z.iso.datetime({ offset: true }),
    entities: z.array(entitySchema).max(50000),
    revisions: z.array(entitySchema).max(200000),
  })
  .strict();
export const allowedStatuses: Record<Kind, string[]> = {
  entry: [],
  structured_entry: ["draft", "active", "rejected", "archived"],
  pattern: ["draft", "active", "rejected", "archived"],
  hypothesis: [
    "draft",
    "active",
    "supported",
    "weakened",
    "rejected",
    "archived",
  ],
  experiment: ["draft", "active", "completed", "cancelled", "archived"],
  experiment_suggestion: ["draft", "active", "rejected", "archived"],
  weekly_review: ["draft", "active", "archived"],
};
export function contentFor(kind: Kind, input: unknown) {
  const parsed =
    kind === "entry" ? entrySchema.parse(input) : knowledgeSchema.parse(input);
  if (kind !== "entry") {
    const k = parsed as z.infer<typeof knowledgeSchema>;
    if (!allowedStatuses[kind].includes(k.status))
      throw new Error("Недопустимый статус наблюдения.");
    if (
      new Set(k.evidence.map((r) => `${r.id}/${r.revision}`)).size !==
      k.evidence.length
    )
      throw new Error("Доказательства не должны повторяться.");
    if (k.start_at && k.end_at && new Date(k.start_at) > new Date(k.end_at))
      throw new Error("Окончание должно быть после начала.");
    if (
      kind === "experiment" &&
      (!k.hypothesis_id ||
        !k.success_criteria.trim() ||
        (k.status === "completed" && !k.result.trim()))
    )
      throw new Error(
        "Укажите гипотезу, критерии успеха и результат завершённого эксперимента.",
      );
  }
  return parsed;
}
