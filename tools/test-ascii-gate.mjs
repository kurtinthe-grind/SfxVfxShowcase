// Proves the printable-ASCII gate actually fails on the bug it was written for.
//
// Injects a non-ASCII glyph into config.ts, runs the gate, expects a non-zero exit,
// then restores the file. A gate that has never been seen to fail is not a gate.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CFG = resolve(ROOT, "src", "config.ts");
const GATE = resolve(HERE, "check-strings.mjs");

const original = readFileSync(CFG, "utf8");
const PLAY = '\u25b6';

function runGate() {
    try {
        execFileSync(process.execPath, [GATE], { cwd: ROOT, stdio: "pipe" });
        return { code: 0, out: "" };
    } catch (e) {
        return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
}

try {
    if (original.includes(PLAY)) {
        console.log("  config.ts already contains a non-ASCII glyph; nothing to inject");
        process.exit(1);
    }
    writeFileSync(CFG, original.replace('playGlyph: "P",', `playGlyph: "${PLAY}",`), "utf8");

    const bad = runGate();
    if (bad.code === 0) {
        console.error("  GATE IS BROKEN: it passed a file containing U+25B6");
        process.exit(1);
    }
    const line = bad.out.split("\n").find((l) => l.includes("U+25B6")) ?? "(no U+25B6 line in output)";
    console.log(`  gate correctly failed (exit ${bad.code})`);
    console.log(`    ${line.trim()}`);
} finally {
    writeFileSync(CFG, original, "utf8");
}

const good = runGate();
if (good.code !== 0) {
    console.error("  GATE IS BROKEN: it failed after the file was restored");
    process.exit(1);
}
console.log("  gate correctly passed once restored");
