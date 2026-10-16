import { writeFileSync } from "node:fs";
import { renderExposeJsonSchema } from "../src/domain/expose/json-schema";

writeFileSync("schema/expose.schema.json", renderExposeJsonSchema());
console.info("Wrote schema/expose.schema.json");
