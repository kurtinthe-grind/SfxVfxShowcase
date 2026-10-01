// Generates src/catalog.ts from the Portal SDK's RuntimeSpawn enums.
//
// Emits TWO catalogs:
//   SFX  - the 938 SFX_ members of RuntimeSpawn_Common
//   VFX  - the 311 FX_ members of RuntimeSpawn_Common (portable, any map)
//
// The other 26 RuntimeSpawn_* enums hold 222 more FX_ members, but those are
// map-specific (FX_Sub_Gas_* only works on Subsurface, etc). Set INCLUDE_MAP_FX
// to true to fold them in with their originating enum recorded per entry.
//
// Source of truth:
//   ../main_resources/bf6-portal-mod-types-master/runtime-spawn-enums/*.d.ts
//   ./banlist.json
//
// Every emitted asset reference is a SYMBOLIC mod.RuntimeSpawn_*.X member, never
// a numeric literal. tsc verifies all references against Tier 0 at build time,
// and a banlisted asset has no numeric fallback that could still reach SpawnObject.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENUM_DIR = resolve(ROOT, "..", "main_resources", "bf6-portal-mod-types-master", "runtime-spawn-enums");
const BANLIST = resolve(ROOT, "banlist.json");
const OUT = resolve(ROOT, "src", "catalog.ts");
// Capacity of the keyboard's PREFIXES page, so the catalog can refuse to ship a
// list the UI could not show in full.
const SCENE_JSON = resolve(ROOT, "src", "scene.json");
const GRID_SLOTS = (() => {
    const pg = JSON.parse(readFileSync(SCENE_JSON, "utf8")).keyboard?.prefixGrid;
    if (!pg) throw new Error("scene.json keyboard.prefixGrid is missing");
    if (pg.max > pg.cols * pg.rows) {
        throw new Error("prefixGrid.max " + pg.max + " exceeds capacity " + pg.cols * pg.rows);
    }
    return pg.cols * pg.rows;
})();

// Fold in the 222 map-specific FX_ members. Off by default: they are not portable.
const INCLUDE_MAP_FX = false;

// --------------------------------------------------------------- SFX classify

const ONESHOT = /_OneShot_?([23]D)$/;
const LOOP = /_(SimpleLoop|Loop|Ambience)_?([23]D)$/;
const DIM_ONLY = /([23]D)$/;
const unclassified = [];

function classifySfx(name) {
    const body = name.replace(/^SFX_/, "");
    let kind = null;
    let dim = null;
    let stem = body;

    const one = body.match(ONESHOT);
    const loop = body.match(LOOP);
    if (one) {
        kind = "oneshot";
        dim = one[1] === "2D" ? "2d" : "3d";
        stem = body.slice(0, body.length - one[0].length);
    } else if (loop) {
        kind = "loop";
        dim = loop[1] === "2D" ? "2d" : "3d";
        stem = body.slice(0, body.length - loop[0].length);
    } else {
        const d = body.match(DIM_ONLY);
        if (d) {
            dim = d[1] === "2D" ? "2d" : "3d";
            stem = body.slice(0, body.length - d[0].length);
        }
        // Default to one-shot: it bounds playback tighter, so a wrong guess is a
        // short clip rather than a long drone. Only self-identified sustained
        // names get loop.
        kind = /Loop|Alarm|Drone|Hum|Ambience/i.test(stem) ? "loop" : "oneshot";
        unclassified.push(`${name} -> ${kind}`);
    }
    return { kind, dim: dim ?? "3d", stem };
}

// --------------------------------------------------------------- VFX classify

// Trailing tokens that add nothing. LOD letters (S/M/L/XS/XL) are deliberately
// KEPT: FX_Snow_BlowingSnow_{S,M,L,XS} are genuinely different sizes, and dropping
// them would collapse four distinct assets into one identical list label.
const NOISE = new Set([
    "GS", "TerrainSnap", "Loop", "B", "C", "D", "01", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

function displayFx(stem) {
    const parts = stem.split("_");
    while (parts.length > 1 && NOISE.has(parts[parts.length - 1])) parts.pop();
    return parts.join(" ").trim() || stem;
}

function categoryFx(name) {
    const seg = name.replace(/^FX_/, "").split("_").filter((s) => s !== "");
    return seg[0] ?? "FX";
}

function readEnumMembers(file, enumName) {
    const src = readFileSync(resolve(ENUM_DIR, file), "utf8");
    const start = src.indexOf(`export enum ${enumName}`);
    if (start < 0) return [];
    const body = src.slice(start, src.indexOf("\n}", start));
    const members = [];
    for (const line of body.split("\n")) {
        const m = line.match(/^\s{4,}([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/);
        if (m) members.push(m[1]);
    }
    return members;
}

// enum member name for the .d.ts, e.g. "common" -> "RuntimeSpawn_Common"
function enumIdent(base) {
    const pascal = base
        .split(/[-_]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("");
    return `RuntimeSpawn_${pascal}`;
}

function main() {
    const commonSfx = readEnumMembers("common.d.ts", "RuntimeSpawn_Common");
    const commonFx = readEnumMembers("common.d.ts", "RuntimeSpawn_Common");

    const banJson = JSON.parse(readFileSync(BANLIST, "utf8"));
    const banned = new Map(banJson.assets.map((a) => [a.name, a.reason]));

    for (const name of banned.keys()) {
        if (!commonSfx.includes(name)) {
            console.error(`\n  BANLIST ERROR: "${name}" is not a SFX_ member of RuntimeSpawn_Common.`);
            console.error(`  Typo or the SDK changed. Fix banlist.json before shipping.\n`);
            process.exit(1);
        }
    }

    // ---------------------------------------------------------------- SFX
    const WINDOW = { oneshot: 2500, loop: 8000 };
    const sfx = commonSfx
        .filter((n) => n.startsWith("SFX_") && !banned.has(n))
        .map((name) => {
            const { kind, dim, stem } = classifySfx(name);
            // Some SDK names contain a doubled underscore (e.g. SFX_Destruction__Old_Ceramic_Generic_OneShot3D). Drop empty segments so the group is not "Destruction_".
            const seg = name.replace(/^SFX_/, "").split("_").filter((s) => s !== "");
            const rest = seg.slice(1).join("_");
            return {
                name,
                display: rest.replace(/_/g, " ").trim(),
                category: seg.slice(0, 2).join("_"),
                kind,
                dim,
                windowMs: WINDOW[kind],
                asset: `mod.RuntimeSpawn_Common.${name}`,
            };
        })
        .sort((a, b) => a.category.localeCompare(b.category) || a.display.localeCompare(b.display));

    // ---------------------------------------------------------------- VFX
    // name -> first enum that declares it, so the emitted ref is always valid.
    const fxSeen = new Map();
    for (const n of commonFx) {
        if (n.startsWith("FX_") || n.startsWith("VFX_")) fxSeen.set(n, "RuntimeSpawn_Common");
    }
    if (INCLUDE_MAP_FX) {
        for (const file of readdirSync(ENUM_DIR)) {
            if (!file.endsWith(".d.ts") || file === "common.d.ts") continue;
            const ident = enumIdent(file.replace(/\.d\.ts$/, ""));
            for (const n of readEnumMembers(file, ident)) {
                if (!n.startsWith("FX_") && !n.startsWith("VFX_")) continue;
                if (fxSeen.has(n)) continue;
                fxSeen.set(n, ident);
            }
        }
    }

    const vfx = [...fxSeen.entries()]
        .map(([name, ident]) => {
            const stem = name.replace(/^(FX|VFX)_/, "");
            return {
                name,
                display: displayFx(stem),
                category: categoryFx(name),
                enum: ident,
                asset: `mod.${ident}.${name}`,
            };
        })
        .sort((a, b) => a.category.localeCompare(b.category) || a.display.localeCompare(b.display));

    // ---------------------------------------------------------------- prefixes
    // The leading token after SFX_ / FX_ / VFX_ (e.g. "Gadgets", "Snow"). Surfaced
    // as a clickable list on the keyboard's second page so players never have to
    // type a long token. Derived from the data, never hand-maintained.
    const prefixOf = (name) => name.replace(/^(SFX_|VFX_|FX_)/, "").split("_")[0] || "";
    const prefixesOf = (list) => {
        const counts = new Map();
        for (const e of list) {
            const t = prefixOf(e.name);
            if (t === "") continue;
            counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        // Collapse case-only collisions (the SDK ships both "GameModes" and
        // "Gamemodes"), keeping the spelling with the most assets so the list
        // never shows two buttons that do the same thing.
        const merged = new Map();
        for (const [token, count] of counts) {
            const k = token.toLowerCase();
            const seen = merged.get(k);
            if (seen === undefined) merged.set(k, { token, count });
            else {
                seen.count += count;
                if (count > seen.count) seen.token = token;
            }
        }
        return [...merged.values()].sort((a, b) => b.count - a.count || a.token.localeCompare(b.token));
    };
    const sfxPrefixes = prefixesOf(sfx);
    const vfxPrefixes = prefixesOf(vfx);
    // The grid must be able to show every prefix; otherwise some are unreachable.
    const need = Math.max(sfxPrefixes.length, vfxPrefixes.length);
    if (need > GRID_SLOTS) {
        throw new Error(`prefix grid holds ${GRID_SLOTS} but ${need} prefixes exist`);
    }
    for (const [kind, list] of [["SFX", sfxPrefixes], ["VFX", vfxPrefixes]]) {
        const seen = new Set();
        for (const e of list) {
            const k = e.token.toLowerCase();
            if (seen.has(k)) throw new Error(`${kind} prefix page has case-colliding token "${e.token}"`);
            seen.add(k);
        }
    }

    const categories = (list, key) => {
        const seen = new Set();
        const out = [];
        for (const e of list) {
            if (!seen.has(e[key])) {
                seen.add(e[key]);
                out.push(e[key]);
            }
        }
        return out;
    };
    const sfxCats = categories(sfx, "category");
    const vfxCats = categories(vfx, "category");

    const q = (s) => JSON.stringify(s);
    const L = [];
    L.push("// AUTO-GENERATED by tools/gen-catalog.mjs - DO NOT EDIT BY HAND.");
    L.push("// Regenerate with: npm run gen");
    L.push(`// SFX members in RuntimeSpawn_Common: ${commonSfx.filter((n) => n.startsWith("SFX_")).length} | banned: ${banned.size} | shipped: ${sfx.length}`);
    L.push(`// FX/VFX members shipped: ${vfx.length} (INCLUDE_MAP_FX=${INCLUDE_MAP_FX}) across ${vfxCats.length} categories`);
    L.push("");
    L.push("export type SfxKind = \"oneshot\" | \"loop\";");
    L.push("export type SfxDim = \"2d\" | \"3d\";");
    L.push("");
    L.push("export interface SfxEntry {");
    L.push("    readonly name: string;");
    L.push("    readonly display: string;");
    L.push("    readonly category: string;");
    L.push("    readonly kind: SfxKind;");
    L.push("    readonly dim: SfxDim;");
    L.push("    /** Playback window we apply, in ms. NOT asset metadata. */");
    L.push("    readonly windowMs: number;");
    L.push("    /** strings.json key for this asset's visible name. */");
    L.push("    readonly key: string;");
    L.push("    /** strings.json key for this asset's group name. */");
    L.push("    readonly catKey: string;");
    L.push("    readonly asset: mod.RuntimeSpawn_Common;");
    L.push("}");
    L.push("");
    L.push("export interface VfxEntry {");
    L.push("    readonly name: string;");
    L.push("    readonly display: string;");
    L.push("    readonly category: string;");
    L.push("    /** Which RuntimeSpawn_* enum declares this member. */");
    L.push("    readonly enum: string;");
    L.push("    /** strings.json key for this asset's visible name. */");
    L.push("    readonly key: string;");
    L.push("    /** strings.json key for this asset's group name. */");
    L.push("    readonly catKey: string;");
    L.push("    readonly asset: mod.RuntimeSpawn_Common;");
    L.push("}");
    L.push("");
    L.push("export interface BannedEntry {");
    L.push("    readonly name: string;");
    L.push("    readonly reason: string;");
    L.push("}");
    L.push("");
    L.push("/**");
    L.push(" * Known game-crashers, filtered out of SFX_CATALOG entirely. No runtime");
    L.push(" * reference to them exists, so the SpawnObject path is unreachable.");
    L.push(" */");
    L.push("export const BANNED: readonly BannedEntry[] = [");
    for (const [name, reason] of banned) L.push(`    { name: ${q(name)}, reason: ${q(reason)} },`);
    L.push("];");
    L.push("");
    L.push("/** Compile-time proof the banned names are real enum members. */");
    L.push("export type BannedProof = [");
    for (const name of banned.keys()) L.push(`    typeof mod.RuntimeSpawn_Common.${name},`);
    L.push("];");
    L.push("");
    L.push("export const SFX_CATEGORIES: readonly string[] = [");
    for (const c of sfxCats) L.push(`    ${q(c)},`);
    L.push("];");
    L.push("");
    L.push("export const VFX_CATEGORIES: readonly string[] = [");
    for (const c of vfxCats) L.push(`    ${q(c)},`);
    L.push("];");
    L.push("");
    L.push("export interface PrefixEntry {");
    L.push("    readonly token: string;");
    L.push("    readonly count: number;");
    L.push("    /** strings.json key for this token. */");
    L.push("    readonly key: string;");
    L.push("}");
    L.push("");
    L.push("/** Leading tokens, most common first. Clickable on the keyboard's PREFIXES page. */");
    L.push("export const SFX_PREFIXES: readonly PrefixEntry[] = [");
    for (const [i, e] of sfxPrefixes.entries()) L.push(`    { token: ${q(e.token)}, count: ${e.count}, key: ${q(keyOf("p", i))} },`);
    L.push("];");
    L.push("");
    L.push("export const VFX_PREFIXES: readonly PrefixEntry[] = [");
    for (const [i, e] of vfxPrefixes.entries()) L.push(`    { token: ${q(e.token)}, count: ${e.count}, key: ${q(keyOf("p", i + sfxPrefixes.length))} },`);
    L.push("];");
    L.push("");
    // ------------------------------------------------------------ message keys
    // Battlefield Portal renders UI text through mod.Message(), which is a lookup
    // into the experience's strings.json -- a bare literal becomes <unknown string>.
    // Every asset name, group and prefix therefore needs a stable key here, and
    // tools/gen-text.mjs writes the matching strings.json entries.
    // Declared as a hoisted function so the prefix emit above can use it too.
    function keyOf(kind, i) {
        return "sx" + kind + i;
    }
    // A row's visible text. Portal renders a strings.json value verbatim, so an
    // empty or non-ASCII value would come out blank or as a "*" glyph; normalise
    // to printable ASCII and fall back to the enum name when the name carries no
    // descriptive tail (e.g. SFX_Alarm).
    const rowText = (d) => {
        let t = String(d ?? "").replace(/[^\x20-\x7E]/g, "").trim();
        if (t === "") t = "";
        return t;
    };
    const asciiOnly = (list) => {
        for (const e of list) {
            const cleaned = rowText(e.display);
            if (cleaned === "" || cleaned !== e.display) {
                e.display = cleaned === "" ? e.name.replace(/^(SFX_|VFX_|FX_)/, "") : cleaned;
            }
        }
    };
    asciiOnly(sfx);
    asciiOnly(vfx);
    // One shared namespace for both catalogs: category names overlap between the
    // SFX and VFX enums, so numbering them separately would mint colliding keys.
    const allCatKeys = new Map();
    for (const name of [...sfxCats, ...vfxCats]) {
        if (!allCatKeys.has(name)) allCatKeys.set(name, keyOf("g", allCatKeys.size));
    }
    const sfxCatKeys = new Map(sfxCats.map((n) => [n, allCatKeys.get(n)]));
    const vfxCatKeys = new Map(vfxCats.map((n) => [n, allCatKeys.get(n)]));

    L.push("export const SFX_CATALOG: readonly SfxEntry[] = [");
    for (const [i, e] of sfx.entries()) {
        L.push(
            `    { name: ${q(e.name)}, display: ${q(e.display)}, category: ${q(e.category)}, ` +
                `kind: ${q(e.kind)}, dim: ${q(e.dim)}, windowMs: ${e.windowMs}, asset: ${e.asset}, ` +
                `key: ${q(keyOf("a", i))}, catKey: ${q(sfxCatKeys.get(e.category))} },`
        );
    }
    L.push("];");
    L.push("");
    L.push("export const VFX_CATALOG: readonly VfxEntry[] = [");
    for (const [i, e] of vfx.entries()) {
        L.push(
            `    { name: ${q(e.name)}, display: ${q(e.display)}, category: ${q(e.category)}, ` +
                `enum: ${q(e.enum)}, asset: ${e.asset}, ` +
                `key: ${q(keyOf("v", i))}, catKey: ${q(vfxCatKeys.get(e.category))} },`
        );
    }
    L.push("];");
    L.push("");
    // The display text actually shown for a row: the catalog name with the
    // SFX_/FX_ noise and the trailing technical suffix stripped. This is the
    // string that needs a strings.json key, not the raw enum name.
    L.push("export interface TextPair {");
    L.push("    readonly key: string;");
    L.push("    readonly text: string;");
    L.push("}");
    L.push("");
    L.push("export const SFX_TEXT: readonly TextPair[] = [");
    for (const [i, e] of sfx.entries()) L.push(`    { key: ${q(keyOf("a", i))}, text: ${q(rowText(e.display))} },`);
    L.push("];");
    L.push("");
    L.push("export const VFX_TEXT: readonly TextPair[] = [");
    for (const [i, e] of vfx.entries()) L.push(`    { key: ${q(keyOf("v", i))}, text: ${q(rowText(e.display))} },`);
    L.push("];");
    L.push("");
    L.push("export const CATEGORY_TEXT: readonly TextPair[] = [");
    for (const [name, key] of allCatKeys) L.push(`    { key: ${q(key)}, text: ${q(name)} },`);
    L.push("];");
    L.push("");
    L.push("export const PREFIX_TEXT: readonly TextPair[] = [");
    for (const [i, e] of [...sfxPrefixes, ...vfxPrefixes].entries()) {
        L.push(`    { key: ${q(keyOf("p", i))}, text: ${q(e.token)} },`);
    }
    L.push("];");

    writeFileSync(OUT, L.join("\n"), "utf8");

    // Sidecar consumed by tools/gen-text.mjs: every display string that needs a
    // strings.json entry, paired with the key the runtime will look up.
    const pairs = [];
    sfx.forEach((e, i) => pairs.push({ key: keyOf("a", i), text: rowText(e.display) }));
    vfx.forEach((e, i) => pairs.push({ key: keyOf("v", i), text: rowText(e.display) }));
    for (const [name, key] of allCatKeys) pairs.push({ key, text: rowText(name) });
    [...sfxPrefixes, ...vfxPrefixes].forEach((e, i) => pairs.push({ key: keyOf("p", i), text: rowText(e.token) }));
    writeFileSync(
        resolve(ROOT, "src", "textkeys.json"),
        JSON.stringify({ pairs }, null, 1) + "\n",
        "utf8"
    );

    // Self-check: a missing closing bracket silently produced an unparseable file
    // once. Verify the emitted text actually brackets every array it opens.
    const emitted = readFileSync(OUT, "utf8");
    const opened = (emitted.match(/= \[\s*$/gm) ?? []).length;
    const closed = (emitted.match(/^\];\s*$/gm) ?? []).length;
    if (opened !== closed) {
        console.error(`  GENERATOR BUG: ${opened} arrays opened but only ${closed} closed in ${OUT}`);
        process.exit(1);
    }
    for (const need of ["SFX_CATALOG", "VFX_CATALOG", "BANNED", "SFX_CATEGORIES", "VFX_CATEGORIES"]) {
        if (!emitted.includes(`export const ${need}:`) && !emitted.includes(`export type ${need} =`)) {
            console.error(`  GENERATOR BUG: ${OUT} is missing an export for ${need}`);
            process.exit(1);
        }
    }
    writeFileSync(
        resolve(ROOT, "src", "catalog.json"),
        JSON.stringify({
            sfx: { total: sfx.length, categories: sfxCats, entries: sfx },
            sfxPrefixes,
            vfxPrefixes,
            vfx: { total: vfx.length, categories: vfxCats, entries: vfx.map((e) => ({ name: e.name, display: e.display, category: e.category })) },
        }),
        "utf8"
    );

    console.log(`  SFX  : ${commonSfx.filter((n) => n.startsWith("SFX_")).length} in SDK - ${banned.size} banned = ${sfx.length} shipped, ${sfxCats.length} categories`);
    console.log(`  VFX  : ${vfx.length} shipped (INCLUDE_MAP_FX=${INCLUDE_MAP_FX}), ${vfxCats.length} categories`);
    const snow = vfx.filter((e) => e.name.includes("Snow")).length;
    const gas = vfx.filter((e) => e.name.includes("Gas")).length;
    console.log(`         prefixes: ${sfxPrefixes.length} SFX, ${vfxPrefixes.length} VFX`);
    console.log(`         snow FX: ${snow}   gas FX: ${gas}`);
    if (unclassified.length) console.log(`  note: ${unclassified.length} SFX had no kind marker (defaulted to one-shot unless Loop/Alarm/Drone/Hum/Ambience)`);
    console.log(`\n  wrote ${OUT}`);
}

main();
