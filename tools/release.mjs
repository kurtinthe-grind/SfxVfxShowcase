// Copies the built bundle to the two upload files at the project root.
//
// Portal takes <ModName>.ts + <ModName>.strings.json (AGENT.md section 6/8). They
// are byte-for-byte dist/, so they are git-ignored and only ever written here --
// a hand copy that was skipped once is how a stale file gets uploaded.
import { copyFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
    ["dist/bundle.ts", "SfxVfxShowcase.ts"],
    ["dist/bundle.strings.json", "SfxVfxShowcase.strings.json"],
];
for (const [from, to] of pairs) {
    copyFileSync(resolve(ROOT, from), resolve(ROOT, to));
    if (!readFileSync(resolve(ROOT, from)).equals(readFileSync(resolve(ROOT, to)))) {
        console.error(`  release: ${to} does not match ${from} after copying`);
        process.exit(1);
    }
}
console.log("  release: SfxVfxShowcase.ts + SfxVfxShowcase.strings.json written from dist/ -- upload these two");
