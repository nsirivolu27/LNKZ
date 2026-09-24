import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tsc does not remove outputs for deleted/renamed source files. Never let
// artifacts from another branch masquerade as tests of this checkout.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".testbuild");
if (dirname(output) !== root) throw new Error("Test output must be inside the repository.");
await rm(output, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
