// Writes src/music.gen.ts and src/musickeys.json from the Tier 0 music enums.
//
// The MUSIC / RADIO tester lists every music event and parameter the SDK has.
// Reading them out of types_original/mod/index.d.ts -- the absolute source of
// truth (AGENT.md 2.1) -- instead of keeping a hand list means a new SDK member
// appears after `npm run gen`, and a removed one becomes a compile error.
//
// Grouping is by name prefix: Core_, BR_, Gauntlet_, Radio_. BRGauntlet_* is
// listed under BR. UNVERIFIED: the SDK does not say which package owns it, and
// the tester loads every package anyway, so the grouping only affects the menu.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TYPES = resolve(ROOT, "..", "main_resources", "types_original", "mod", "index.d.ts");
const OUT_TS = resolve(ROOT, "src", "music.gen.ts");
const OUT_KEYS = resolve(ROOT, "src", "musickeys.json");

// Parameter ranges. The engine cannot be queried for them, so these are guesses
// to be tuned in game; the panel says so. Anything missing here falls back to
// DEFAULT_SPEC and is reported, so a new SDK param is never silently unusable.
const SPEC = {
    Core_IsWinning: { min: 0, max: 1, step: 1, def: 0 },
    Core_Sector: { min: 0, max: 10, step: 1, def: 0 },
    Core_Urgency: { min: 0, max: 1, step: 0.1, def: 0 },
    Core_PhaseUrgency: { min: 0, max: 1, step: 0.1, def: 0 },
    BRGauntlet_LobbyTimerRemaining: { min: 0, max: 300, step: 10, def: 60 },
    Radio_Channel: { min: 0, max: 10, step: 1, def: 0 },
    Radio_Biome: { min: 0, max: 10, step: 1, def: 0 },
    Radio_QueueTrackNumber: { min: 0, max: 20, step: 1, def: 0 },
    Radio_LoopQueuedTracks: { min: 0, max: 1, step: 1, def: 0 },
    Radio_ContinueQueueOnTrackEnd: { min: 0, max: 1, step: 1, def: 1 },
};
// Volume. The SDK examples use 1.3 and 1.8, so 2 is a guess at a sane top.
const AMP_SPEC = { min: 0, max: 2, step: 0.1, def: 1 };
const DEFAULT_SPEC = { min: 0, max: 10, step: 1, def: 0 };

/** The UI has this many param rows; gen fails if a package needs more. */
const PARAM_SLOTS = 5;

function readEnum(src, name) {
    const start = src.indexOf(`export enum ${name} {`);
    if (start < 0) throw new Error(`index.d.ts has no enum ${name}`);
    const body = src.slice(start + `export enum ${name} {`.length, src.indexOf("}", start));
    return body
        .split("\n")
        .map((l) => l.trim().replace(/,$/, ""))
        .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(l));
}

function packageOf(member) {
    if (member.startsWith("BRGauntlet_") || member.startsWith("BR_")) return "BR";
    const p = member.slice(0, member.indexOf("_"));
    return p;
}

const src = readFileSync(TYPES, "utf8");
const packages = readEnum(src, "MusicPackages");
const events = readEnum(src, "MusicEvents");
const params = readEnum(src, "MusicParams");

const problems = [];
const pairs = [];
let n = 0;
const keyFor = (text) => {
    const key = "sxM" + String(n++).padStart(2, "0");
    pairs.push({ key, text });
    return key;
};

const out = [];
for (const pkg of packages) {
    const evts = events.filter((e) => packageOf(e) === pkg);
    const stops = evts.filter((e) => /_Stop$/.test(e));
    const list = evts.filter((e) => !/_Stop$/.test(e));
    const ps = params.filter((p) => packageOf(p) === pkg);
    const amps = ps.filter((p) => /_Amplitude$/.test(p));
    const rows = ps.filter((p) => !/_Amplitude$/.test(p));
    if (!packages.includes(pkg)) problems.push(`package ${pkg} is not a MusicPackages member`);
    if (stops.length !== 1) problems.push(`package ${pkg} has ${stops.length} *_Stop events, expected 1`);
    if (amps.length !== 1) problems.push(`package ${pkg} has ${amps.length} *_Amplitude params, expected 1`);
    if (rows.length > PARAM_SLOTS) problems.push(`package ${pkg} has ${rows.length} params, the UI has ${PARAM_SLOTS} rows`);
    for (const p of rows) if (SPEC[p] === undefined) problems.push(`param ${p} has no range in gen-music.mjs SPEC (would use ${JSON.stringify(DEFAULT_SPEC)})`);
    out.push({
        name: pkg,
        key: keyFor(pkg.toUpperCase()),
        stop: stops[0],
        stopKey: keyFor(stops[0]),
        events: list.map((e) => ({ name: e, key: keyFor(e) })),
        amp: { name: amps[0], key: keyFor(amps[0]), ...AMP_SPEC },
        params: rows.map((p) => ({ name: p, key: keyFor(p), ...(SPEC[p] ?? DEFAULT_SPEC) })),
    });
}
const assigned = new Set(out.flatMap((p) => [p.stop, ...p.events.map((e) => e.name)]));
for (const e of events) if (!assigned.has(e)) problems.push(`event ${e} matched no package`);
const assignedP = new Set(out.flatMap((p) => [p.amp.name, ...p.params.map((x) => x.name)]));
for (const p of params) if (!assignedP.has(p)) problems.push(`param ${p} matched no package`);
for (const name of ["Core", "BR", "Gauntlet", "Radio"]) if (!packages.includes(name)) problems.push(`MusicPackages has no ${name}`);

if (problems.length > 0) {
    console.error("  MUSIC BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}

const q = JSON.stringify;
const L = [];
L.push("// GENERATED by tools/gen-music.mjs from types_original/mod/index.d.ts -- do not edit.");
L.push("//");
L.push("// Every music package, its events, its parameters and their (guessed) ranges.");
L.push("// `key` fields are strings.json keys for the on-screen names.");
L.push("");
L.push("export interface MusicParamSpec {");
L.push("    readonly name: string;");
L.push("    readonly param: mod.MusicParams;");
L.push("    readonly key: string;");
L.push("    readonly min: number;");
L.push("    readonly max: number;");
L.push("    readonly step: number;");
L.push("    readonly def: number;");
L.push("}");
L.push("");
L.push("export interface MusicEventSpec {");
L.push("    readonly name: string;");
L.push("    readonly event: mod.MusicEvents;");
L.push("    readonly key: string;");
L.push("}");
L.push("");
L.push("export interface MusicPackageSpec {");
L.push("    readonly name: string;");
L.push("    readonly pkg: mod.MusicPackages;");
L.push("    readonly key: string;");
L.push("    /** The package's own *_Stop event, sent by STOP. Not in `events`. */");
L.push("    readonly stop: mod.MusicEvents;");
L.push("    readonly stopKey: string;");
L.push("    readonly events: readonly MusicEventSpec[];");
L.push("    /** The package's *_Amplitude param: the VOLUME control. Not in `params`. */");
L.push("    readonly amp: MusicParamSpec;");
L.push("    readonly params: readonly MusicParamSpec[];");
L.push("}");
L.push("");
L.push(`export const PARAM_SLOTS = ${PARAM_SLOTS};`);
L.push("");
const param = (p) =>
    `{ name: ${q(p.name)}, param: mod.MusicParams.${p.name}, key: ${q(p.key)}, min: ${p.min}, max: ${p.max}, step: ${p.step}, def: ${p.def} }`;
L.push("export const MUSIC_PACKAGES: readonly MusicPackageSpec[] = [");
for (const p of out) {
    L.push("    {");
    L.push(`        name: ${q(p.name)},`);
    L.push(`        pkg: mod.MusicPackages.${p.name},`);
    L.push(`        key: ${q(p.key)},`);
    L.push(`        stop: mod.MusicEvents.${p.stop},`);
    L.push(`        stopKey: ${q(p.stopKey)},`);
    L.push("        events: [");
    for (const e of p.events) L.push(`            { name: ${q(e.name)}, event: mod.MusicEvents.${e.name}, key: ${q(e.key)} },`);
    L.push("        ],");
    L.push(`        amp: ${param(p.amp)},`);
    L.push("        params: [");
    for (const x of p.params) L.push(`            ${param(x)},`);
    L.push("        ],");
    L.push("    },");
}
L.push("];");
L.push("");
writeFileSync(OUT_TS, L.join("\n"));
writeFileSync(OUT_KEYS, JSON.stringify({ pairs }, null, 1) + "\n");

const counts = out.map((p) => `${p.name} ${p.events.length} events/${p.params.length} params`).join(", ");
console.log(`  music   : ${counts}`);
console.log(`  wrote ${OUT_TS}`);
