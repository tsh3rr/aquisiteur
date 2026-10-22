import { z } from "zod";

/** Projects of a customer (§7.10). */

export const PROJECT_STATUSES = [
  "idea",
  "offered",
  "ordered",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  idea: "Idee",
  offered: "Angeboten",
  ordered: "Beauftragt",
  in_progress: "In Arbeit",
  done: "Abgeschlossen",
  cancelled: "Abgebrochen",
};

export const PROJECT_STATUS_TONES: Record<
  ProjectStatus,
  "neutral" | "accent" | "success" | "warning" | "danger"
> = {
  idea: "neutral",
  offered: "accent",
  ordered: "success",
  in_progress: "success",
  done: "neutral",
  cancelled: "danger",
};

/** Name of the project migration 0022 and the exposé publish create for existing work. */
export const FIRST_PROJECT_NAME = "Erstakquise";

export const projectFormSchema = z.object({
  name: z.string().trim().min(2, "Bitte einen Namen angeben.").max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value ? value : null)),
});
export type ProjectForm = z.output<typeof projectFormSchema>;
