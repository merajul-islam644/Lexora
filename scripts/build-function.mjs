/* Bundles src/function/handler.ts into dist-function/ for
   `blocks logic function save <id> --dir dist-function`.
   The Blocks VITE_* values are baked in at build time from .env. */
import fs from "node:fs";
import { build } from "esbuild";

// Minimal .env loader (no dependency on dotenv).
const envFile = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of envFile.split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !line.trimStart().startsWith("#")) {
    const k = line.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = line.slice(i + 1).trim();
  }
}

fs.rmSync("dist-function", { recursive: true, force: true });
fs.mkdirSync("dist-function", { recursive: true });

await build({
  entryPoints: [new URL("../src/function/handler.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: "dist-function/index.js",
  define: {
    "process.env.VITE_BLOCKS_API_URL": JSON.stringify(process.env.VITE_BLOCKS_API_URL ?? ""),
    "process.env.VITE_BLOCKS_X_BLOCKS_KEY": JSON.stringify(process.env.VITE_BLOCKS_X_BLOCKS_KEY ?? "")
  },
  legalComments: "none",
  logLevel: "info"
});

// The platform requires "type": "module" and reads metadata from this file.
fs.writeFileSync(
  "dist-function/package.json",
  JSON.stringify({ name: "lexora-api", version: "1.0.0", type: "module", private: true }, null, 2) + "\n"
);
console.log("dist-function/index.js ready for `blocks logic function save`");
