// Gates the strings.json contract and Portal's font limits.
//
// The failure this catches is invisible in a browser preview and total in game:
// mod.Message() resolves a KEY against the experience's strings.json, so a label
// that has no entry renders as <unknown string> rather than raising an error. The
// preview always has the text, so nothing else would notice.
//
// Checks, in order:
//   1. every key the code can pass to mod.Message exists in strings.json;
//   2. every value in strings.json is non-empty printable ASCII;
//   3. no source file passes a bare string literal straight to mod.Message;
//   4. every string literal in src/ is printable ASCII -- this is what catches
//      CONFIG.playGlyph = "\u25b6", which check 2 cannot see because the glyph
//      lives in config.ts rather than in the table.
//
// Portal's UI font has no arbitrary UTF-8: a glyph outside printable ASCII comes
// out as "*". Comments are stripped before scanning, since they quote
// mod.Message("SOUND") to explain the failure mode and carry non-ASCII of their
// own, and never reach a widget.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src");

const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** First non-printable-ASCII code point in a string, or undefined. */
function badChar(s) {
    for (const ch of s) {
        const n = ch.codePointAt(0);
        if (n < 0x20 || n > 0x7e) return n;
    }
    return undefined;
}

const strings = JSON.parse(readFileSync(resolve(SRC, "strings.json"), "utf8"));
const text = readFileSync(resolve(SRC, "text.gen.ts"), "utf8");
const catalog = readFileSync(resolve(SRC, "catalog.ts"), "utf8");
const problems = [];

// ---- 1. every key named in the generated tables exists
const declared = new Set();
for (const m of text.matchAll(/^\s{4}\w+: "([^"]+)",$/gm)) declared.add(m[1]);
for (const block of ["CHAR_KEY", "SCENE_TEXT"]) {
    const i = text.indexOf(`export const ${block}`);
    if (i < 0) {
        problems.push(`text.gen.ts is missing ${block}`);
        continue;
    }
    const end = text.indexOf("};", i);
    for (const m of text.slice(i, end).matchAll(/: "([^"]+)"/g)) declared.add(m[1]);
}
// Keys the catalog mints for assets, groups and prefixes.
for (const m of catalog.matchAll(/key: "(sxa\d+|sxv\d+|sxg\d+|sxp\d+)"/g)) declared.add(m[1]);
for (const m of catalog.matchAll(/catKey: "(sxg\d+)"/g)) declared.add(m[1]);
for (const m of catalog.matchAll(/lengthKey: "(sxl\w+)"/g)) declared.add(m[1]);

for (const key of declared) {
    if (!Object.prototype.hasOwnProperty.call(strings, key)) {
        problems.push(`key ${key} is used by the code but missing from strings.json`);
    }
}

// ---- 2. every value in the table is non-empty printable ASCII
for (const [key, value] of Object.entries(strings)) {
    if (typeof value !== "string" || value === "") {
        problems.push(`${key} has an empty or non-string value`);
        continue;
    }
    const n = badChar(value);
    if (n !== undefined) {
        problems.push(`${key} contains U+${n.toString(16).toUpperCase()}, which Portal's font cannot draw`);
    }
}

// ---- 3 and 4. per-source checks
const sources = readdirSync(SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".gen.ts"));
for (const file of sources) {
    const body = stripComments(readFileSync(resolve(SRC, file), "utf8"));

    for (const m of body.matchAll(/mod\.Message\("([^"]*)"/g)) {
        if (!declared.has(m[1])) {
            problems.push(`src/${file} calls mod.Message("${m[1]}") with a literal instead of a generated key`);
        }
    }

    for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const n = badChar(m[1]);
        if (n !== undefined) {
            problems.push(
                `src/${file} has U+${n.toString(16).toUpperCase()} in the string literal ${JSON.stringify(m[1])}`
            );
        }
    }
}

if (problems.length > 0) {
    console.error("  STRINGS BUGS:");
    for (const p of problems.slice(0, 25)) console.error("    - " + p);
    if (problems.length > 25) console.error(`    ... and ${problems.length - 25} more`);
    process.exit(1);
}

console.log(
    `  strings  : ${Object.keys(strings).length} keys, all referenced keys present, ` +
        `all values and ${sources.length} source files printable ASCII`
);
