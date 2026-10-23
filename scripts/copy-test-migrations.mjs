import { cp } from "node:fs/promises";

await cp("src/lnkz/store/migrations", ".testbuild/src/lnkz/store/migrations", { recursive: true });
