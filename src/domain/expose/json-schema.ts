import { z } from "zod";
import { exposeSchema } from "./schema";

/** JSON Schema of the authoring format (input side: defaults are optional). */
export function exposeJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(exposeSchema, { io: "input", target: "draft-2020-12" });
  return {
    ...schema,
    $id: "https://aquisiteur.app/schema/expose.schema.json",
    title: "Aquisiteur Exposé",
    description:
      "Personalised exposé rendered by Aquisiteur. Generated from src/domain/expose/schema.ts; see docs/EXPOSE_AUTHORING.md.",
  };
}

export function renderExposeJsonSchema(): string {
  return `${JSON.stringify(exposeJsonSchema(), null, 2)}\n`;
}
