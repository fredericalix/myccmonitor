// Copies user-facing markdown docs from ../docs/ into frontend/src/_docs/
// at build time. The `frontend/` directory is the only one shipped to the
// CC Node runtime (APP_FOLDER=frontend), so anything outside it disappears
// at deploy time. The Server Component at /docs reads from the bundled copy
// via fs.readFile(process.cwd()/src/_docs/...).
//
// Source of truth: docs/USER_GUIDE.md (root of the repo). Do not edit the
// _docs copy directly — it gets overwritten on every build.

import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "../docs/USER_GUIDE.md");
const DST = resolve(ROOT, "src/_docs/USER_GUIDE.md");

await mkdir(dirname(DST), { recursive: true });
await copyFile(SRC, DST);
console.log(`[copy-docs] ${SRC} → ${DST}`);
