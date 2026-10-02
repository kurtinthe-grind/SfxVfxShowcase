// Writes registry/mapping-<n>.json, src/qrids.gen.ts and site/data/*.json.
//
// The registry is the one source of truth for QR IDs. This tool appends IDs for new
// assets, marks assets that left the catalog as retired, and fails without writing
// anything if the registry is invalid or if a published ID would change meaning.
// The mod's lookup (src/qrids.gen.ts) and the website's tables (site/data/) are both
// derived from it, so the two can never disagree.
//
// Mappings: registry/mapping-<n>.json, highest n is current. Older mappings are
// frozen: validated and republished for old codes, never changed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assignIds, compareRegistries, emptyRegistry, formatRegistry, idNumbers, idRuns, siteMap, validateRegistry } from "./registry.mjs";
import { FORMAT } from "../site/js/codec.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REG_DIR = resolve(ROOT, "registry");
const OUT_TS = resolve(ROOT, "src", "qrids.gen.ts");
const DATA = resolve(ROOT, "site", "data");
const CHECK_ONLY = process.argv.includes("--check");

function fail(lines) {
    console.error("  ids     : REGISTRY ERRORS:");
    for (const l of lines) console.error("    - " + l);
    process.exit(1);
}

// ---------------------------------------------------------------- current sources

const catalog = JSON.parse(readFileSync(resolve(ROOT, "src", "catalog.json"), "utf8"));
const sfx = catalog.sfx.entries;
const vfx = catalog.vfx.entries;

const indexTs = readFileSync(resolve(ROOT, "src", "index.ts"), "utf8");
const screen = [...indexTs.matchAll(/\{ id: "(\w+)", display: "([^"]+)", category: "([^"]+)"/g)].map((m) => ({ id: m[1], display: m[2], category: m[3] }));
if (screen.length === 0) fail(["no SCREEN_FX entries found in src/index.ts"]);

const musicTs = readFileSync(resolve(ROOT, "src", "music.gen.ts"), "utf8");
const packages = musicTs
    .split(/pkg: mod\.MusicPackages\./)
    .slice(1)
    .map((block) => {
        const name = /^(\w+)/.exec(block)[1];
        const events = [...block.matchAll(/\{ name: "(\w+)", event: mod\.MusicEvents\./g)].map((m) => m[1]);
        const amp = /amp: \{ name: "(\w+)"/.exec(block)[1];
        const params = [...block.matchAll(/\{ name: "(\w+)", param: mod\.MusicParams\./g)].map((m) => m[1]);
        return { name, events, amp, params };
    });
if (packages.length === 0) fail(["no music packages found in src/music.gen.ts"]);

const textTs = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
const radioM = /channels: (\[[^\]]*\]),\s*biomes: (\[[^\]]*\])/.exec(textTs);
if (radioM === null) fail(["no RADIO_TEXT found in src/text.gen.ts"]);
const radio = { channels: JSON.parse(radioM[1]), biomes: JSON.parse(radioM[2]) };

const current = [
    ...sfx.map((e) => ({ kind: "sfx", name: e.name })),
    ...vfx.map((e) => ({ kind: "vfx", name: e.name })),
    ...screen.map((s) => ({ kind: "screen", name: s.id })),
    ...packages.flatMap((p) => p.events.map((n) => ({ kind: "music-event", name: n }))),
    ...packages.flatMap((p) => p.params.map((n) => ({ kind: "music-param", name: n }))),
];

const details = new Map();
for (const e of sfx) details.set("sfx:" + e.name, { g: e.category });
for (const e of vfx) details.set("vfx:" + e.name, { g: e.category });
for (const s of screen) details.set("screen:" + s.id, { g: s.category, l: s.display });
for (const p of packages) {
    for (const n of p.events) details.set("music-event:" + n, { g: p.name });
    for (const n of p.params) details.set("music-param:" + n, n === p.amp ? { g: p.name, a: 1 } : { g: p.name });
}

// ---------------------------------------------------------------- registries

const files = existsSync(REG_DIR)
    ? readdirSync(REG_DIR)
          .map((f) => /^mapping-(\d+)\.json$/.exec(f))
          .filter((m) => m !== null)
          .map((m) => ({ n: Number(m[1]), path: resolve(REG_DIR, m[0]) }))
          .sort((a, b) => a.n - b.n)
    : [];
if (files.length === 0) files.push({ n: 1, path: resolve(REG_DIR, "mapping-1.json"), fresh: true });

/** The registry as last committed, if git has it: the published state to protect. */
function committed(path) {
    try {
        const rel = relative(ROOT, path).split("\\").join("/");
        return JSON.parse(execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch {
        return undefined;
    }
}

const problems = [];
const regs = [];
for (const f of files) {
    const reg = f.fresh ? emptyRegistry(f.n) : JSON.parse(readFileSync(f.path, "utf8"));
    for (const p of validateRegistry(reg)) problems.push(`${relative(ROOT, f.path)}: ${p}`);
    if (!f.fresh && reg.mapping !== f.n) problems.push(`${relative(ROOT, f.path)}: says mapping ${reg.mapping}`);
    const before = committed(f.path);
    if (before !== undefined) for (const p of compareRegistries(before, reg)) problems.push(`${relative(ROOT, f.path)} vs git HEAD: ${p}`);
    regs.push({ ...f, reg });
}
if (problems.length > 0) fail(problems);

const cur = regs[regs.length - 1];
const original = cur.reg;
const r = assignIds(original, current);
cur.reg = r.registry;
cur.reg.$comment ??= "QR asset IDs, append-only. Generated by tools/gen-ids.mjs: never edit an id, kind or name by hand. See docs/QR-MAPPING.md.";
const post = [...validateRegistry(cur.reg), ...compareRegistries(original, cur.reg)];
if (post.length > 0) fail(post);

// ---------------------------------------------------------------- outputs

const outputs = new Map();
outputs.set(cur.path, formatRegistry(cur.reg));

const sfxNums = idNumbers(cur.reg, "sfx", sfx.map((e) => e.name));
const vfxNums = idNumbers(cur.reg, "vfx", vfx.map((e) => e.name));
const named = [
    ...screen.map((s) => ["screen:" + s.id, idNumbers(cur.reg, "screen", [s.id])[0]]),
    ...packages.flatMap((p) => p.events.map((n) => ["e:" + n, idNumbers(cur.reg, "music-event", [n])[0]])),
    ...packages.flatMap((p) => p.params.map((n) => ["p:" + n, idNumbers(cur.reg, "music-param", [n])[0]])),
];
const ts = [
    `// AUTO-GENERATED by tools/gen-ids.mjs from registry/mapping-${cur.n}.json - DO NOT EDIT BY HAND.`,
    "// Stable QR IDs. Catalog index -> ID number as runs: [first index, its ID, ...].",
    "",
    `export const QR_FORMAT = ${FORMAT};`,
    `export const QR_MAPPING = ${cur.n};`,
    `export const SFX_ID_RUNS: readonly number[] = ${JSON.stringify(idRuns(sfxNums))};`,
    `export const VFX_ID_RUNS: readonly number[] = ${JSON.stringify(idRuns(vfxNums))};`,
    "/** Screen effects by row key, music events (e:) and params (p:) by name. */",
    "export const NAMED_IDS: { readonly [key: string]: number } = {",
    ...named.map(([k, v]) => `    ${JSON.stringify(k)}: ${v},`),
    "};",
    "",
].join("\n");
outputs.set(OUT_TS, ts);

const index = { $comment: "Generated by tools/gen-ids.mjs.", formats: [FORMAT], current: cur.n, mappings: {} };
for (const g of regs) {
    const file = `map-${g.n}.json`;
    index.mappings[g.n] = file;
    outputs.set(resolve(DATA, file), JSON.stringify(siteMap(g.reg, details, radio)) + "\n");
}
outputs.set(resolve(DATA, "maps.json"), JSON.stringify(index, null, 4) + "\n");

const stale = [];
for (const [path, text] of outputs) {
    const old = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (old === text) continue;
    if (CHECK_ONLY) stale.push(relative(ROOT, path));
    else writeFileSync(path, text, "utf8");
}
if (CHECK_ONLY && stale.length > 0) fail([`out of date, run npm run gen: ${stale.join(", ")}`]);

const sum = `${cur.reg.assets.length} IDs in mapping ${cur.n} (${cur.reg.assets.filter((e) => e.status === "retired").length} retired), next ${cur.reg.next}`;
const change = [r.added.length > 0 ? `${r.added.length} added` : "", r.retired.length > 0 ? `${r.retired.length} retired` : "", r.revived.length > 0 ? `${r.revived.length} revived` : ""].filter(Boolean).join(", ");
console.log(`  ids     : ${sum}${change !== "" ? "; " + change : ""}; runs sfx ${idRuns(sfxNums).length / 2}, vfx ${idRuns(vfxNums).length / 2}`);
if (!CHECK_ONLY) console.log(`  wrote ${[...outputs.keys()].map((p) => relative(ROOT, p)).join(", ")}`);
