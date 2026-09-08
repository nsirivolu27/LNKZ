import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/index.ts", "src/lnkz/stdio.ts", "src/lnkz/store/migrate.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  sourcemap: "linked",
  logLevel: "info",
  external: ["node:*"],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; globalThis.require = __createRequire(import.meta.url);",
  },
});
