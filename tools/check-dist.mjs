// Real compliance gate for the delivery artifact.
//
// dist/bundle.ts starts with `// @ts-nocheck`, which makes a plain tsc run
// silently useless - it would pass even on unparseable output (which is exactly
// how an imported .json got shipped once already). This strips that directive
// into a temp copy and typechecks the result, so a broken bundle fails the build.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const BUNDLE = resolve(ROOT, "dist", "bundle.ts");
const PROBE = resolve(ROOT, "dist", ".bundle.check.ts");
const TSCONFIG = resolve(ROOT, "tsconfig.dist.json");

if (!existsSync(BUNDLE)) {
    console.error("  dist/bundle.ts not found - run `npm run bundle` first.");
    process.exit(1);
}

const NOCHECK = "@ts-" + "nocheck";
const src = readFileSync(BUNDLE, "utf8");
const stripped = src.replace(/^\s*\/\/\s*@ts-nocheck.*$/m, "// suppression directive removed by tools/check-dist.mjs");
writeFileSync(PROBE, stripped, "utf8");

// Fail loudly if the guard is not actually doing anything.
if (readFileSync(PROBE, "utf8").includes(NOCHECK)) {
    console.error("  FAILED to strip the suppression directive - the gate would be vacuous.");
    process.exit(1);
}

const TSC = resolve(ROOT, "node_modules", "typescript", "bin", "tsc");
const res = spawnSync(process.execPath, [TSC, "--noEmit", "-p", TSCONFIG], {
    cwd: ROOT,
    shell: false,
    encoding: "utf8",
});

try {
    unlinkSync(PROBE);
} catch {
    /* best effort */
}

const out = (res.stdout ?? "") + (res.stderr ?? "");

if (res.status !== 0) {
    console.error("  dist/bundle.ts FAILED the delivery typecheck:");
    console.error(out.split("\n").slice(0, 40).join("\n"));
    process.exit(res.status ?? 1);
}

console.log("  dist/bundle.ts: parses and typechecks against Tier 0 (@ts-nocheck stripped)");
console.log(`  ${BUNDLE.replace(ROOT + "\\", "")}: ${src.length.toLocaleString()} bytes`);
