// Builds the API as a Vercel "Build Output API" bundle: .vercel/output at the repository root.
// Deploy it with:  vercel deploy --prebuilt --prod   (run from the repository root)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { build as esbuild } from "esbuild";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(artifactDir, "../../.vercel/output");
const funcDir = path.join(outputDir, "functions/api.func");

await rm(outputDir, { recursive: true, force: true });
await mkdir(funcDir, { recursive: true });

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/vercel.ts")],
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outfile: path.join(funcDir, "index.mjs"),
  logLevel: "info",
  // Same native modules the normal server build leaves out.
  external: ["*.node", "pg-native", "sharp", "bufferutil", "utf-8-validate"],
  // Some CommonJS dependencies call require() at runtime; give the ESM bundle one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
});

await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    { runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false },
    null,
    2,
  ),
);
await writeFile(path.join(funcDir, "package.json"), JSON.stringify({ type: "module" }));
await writeFile(
  path.join(outputDir, "config.json"),
  JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/api" }] }, null, 2),
);

console.log("Vercel output written to", outputDir);
