import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTokensCss } from "../src/design/render-css";

const target = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
writeFileSync(target, renderTokensCss());
console.info(`Wrote ${target}`);
