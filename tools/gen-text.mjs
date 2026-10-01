// Writes src/text.gen.ts and src/strings.json.
//
// WHY THIS EXISTS
// Battlefield Portal renders UI text through mod.Message(), which is a LOOKUP into
// the experience's strings.json. Passing a bare literal does not print the literal:
// the engine reports <unknown string> for every key it cannot resolve. The mod-types
// docs are explicit -- "All strings passed as arguments must be found in the
// strings.json which is injected as mod.stringkeys" -- so every single string the
// panel can display needs an entry there, and the file has to be uploaded with the
// experience.
//
// Consequence: this generator owns the text contract. It emits a typed map (T) so a
// missing label is a TypeScript compile error rather than an invisible blank in game.
//
// It also enforces Portal's font limits: values must be non-empty printable ASCII.
// The engine's custom UI font has no arbitrary UTF-8, so an em dash or a block
// cursor renders as "*".

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCENE = resolve(ROOT, "src", "scene.json");
const PAIRS = resolve(ROOT, "src", "textkeys.json");
const OUT_TS = resolve(ROOT, "src", "text.gen.ts");
const OUT_JSON = resolve(ROOT, "src", "strings.json");

// ---------------------------------------------------------------------------
// Curated labels. Names here are referenced as T.<name> from the UI code, so
// renaming one is a compile error and a missing one cannot ship silently.
// ---------------------------------------------------------------------------
const STATIC = {
    // chrome
    title: "SFX / VFX SHOWCASE",
    tabSound: "SOUND",
    tabVisual: "VISUAL",
    close: "CLOSE X",
    group: "GROUP",
    name: "NAME",
    action: "ACTION",
    amplitude: "AMPLITUDE",
    rangeM: "RANGE m",
    scaleWord: "SCALE",
    undo: "UNDO",
    deleteAll: "DELETE ALL",
    stopAll: "STOP ALL",
    // favourites
    favouritesTab: "FAVOURITES",
    favColumn: "FAV",
    favAdd: "+",
    favRemove: "*",
    kindSfx: "SFX",
    kindVfx: "VFX",
    noFavourites: "No favourites yet. Use + on a row.",
    exportFavs: "EXPORT FAVOURITES",
    stop: "STOP",
    debugOn: "DEBUG ON",
    debugOff: "DEBUG OFF",
    // Row controls. PLAY auditions the asset in place; SELECT arms it for fire.
    play: "PLAY",
    // The group rail is longer than the panel, so it pages like the list does.
    railPrev: "< GROUPS",
    railNext: "GROUPS >",
    applyEffect: "applies to the selected effect",
    // keyboard
    space: "SPACE",
    back: "BACK",
    clear: "CLEAR",
    done: "DONE",
    prefixes: "PREFIXES",
    abcKeys: "ABC KEYS",
    search: "SEARCH",
    keyboardOpen: "KEYBOARD OPEN",
    minus: "-",
    plus: "+",
    // filter chips
    // Row action glyphs. Must match CONFIG.playGlyph / spawnGlyph / effectGlyph
    // in src/config.ts; tools/test-fields.mjs fails the build if they diverge.
    playGlyph: "P",
    spawnGlyph: "S",
    effectGlyph: "T",
    chipAll: "ALL",
    chip3d: "3D",
    chip2d: "2D",
    chipLoop: "LOOP",
    chipOne: "ONE",
    chipWorld: "WORLD",
    chipPlayer: "PLAYER",
    // state words
    nothingArmed: "NOTHING ARMED",
    selectAnItem: "SELECT AN ITEM",
    selected: "SELECTED",
    select: "SELECT",
    armedWord: "ARMED",
    spatiality: "SPATIALITY",
    typeToSearch: "type to search",
    typeToSearchDot: "type to search.",
    tapPrefix: "tap a prefix, then refine on ABC",
    // hints
    hintSearch: "Type with the on-screen keyboard. It searches names across every group. DONE closes the keyboard, CLEAR empties it.",
    hintClosed: "MENU CLOSED - aim (right mouse) to reopen - fire (left mouse) to spawn what is armed",
    hintVfxPick: "SEARCH or pick an effect, set SCALE, then SELECT. The menu closes and the gadget arms it.",
    hintVfxArmed: "Fire to place it at your aim point. Aim reopens the menu to change it, undo, or delete all.",
    hintSfxPick: "SEARCH or pick a sound, set AMPLITUDE and RANGE, then SELECT. The menu closes and the gadget arms it.",
    hintSfxArmed: "Auditions straight away. Fire to place it at your aim point, or aim to reopen the menu.",
    // notifications (pre-existing)
    armFirst: "Aim to open the menu, pick a sound or effect, press SELECT, then fire",
    noSurface: "No surface in range",
    pickFirst: "Select an item first",
    nothingToUndo: "Nothing to undo",
    // player-wide effects: not catalog assets, so they get their own keys
    screenVl7gas: "VL7 Gas Mask",
    screenNight: "Night Vision",
    screenSaturated: "Saturated",
    screenStealth: "Stealth",
    catGas: "Gas",
    catScreen: "Screen",
    // on-screen log, so a playtest can be reported from a screenshot
    logEmpty: " ",
    charCursor: "_",
    onWord: "ON",
    // Visible fallback, not a log line: msgFor() and S() in ui.ts use this
    // whenever a text key is missing, so the player sees this string instead
    // of a blank widget.
    logBadMessage: "text key missing from strings.json",
    offWord: "OFF",
};

// Format templates. Portal's Message accepts up to three {} substitutions and
// numbers may be passed as arguments without needing their own entry.
const TEMPLATES = {
    t1: "{}",
    t2: "{}{}",
    t3: "{}{}{}",
    t4: "{}{}{}{}",
    // A lone number, e.g. the amplitude read-out.
    num1: "{}",
    // "<group>   <count>" for the rail.
    gap2: "{}   {}",
    armedOf: "ARMED: {}",
    itemsOf: "{} ITEMS",
    matchOf: "{} / {} MATCH",
    matchOf2: "{} of {} MATCH",
    pageOf: "PAGE {} / {}",
    railPageOf: "GROUPS {} / {}",
    exportedN: "Exported {} asset name(s) to the log",
    stoppedN: "Stopped {} sound(s)",
    scaleOf: "{}x",
    spawnedOf: "SPAWNED IN WORLD: {}",
    // The active filter summary needs a template per combination, because a
    // Message argument is itself a key rather than another Message.
    filters0: "FILTERS: no filter",
    filters1: "FILTERS: {}",
    filters2: "FILTERS: {} + {}",
    filters3: "FILTERS: {} + {} + {}",
    screenToggle: "{} {}",
};

const q = (s) => JSON.stringify(String(s));

// ---------------------------------------------------------------------------
// Harvest every literal that scene.json can put on screen. scene.json is the
// single source of truth for widget text, and the runtime looks text up by the
// literal it reads out of the spec, so the map is literal -> key.
// ---------------------------------------------------------------------------
function harvestSceneLiterals() {
    const scene = JSON.parse(readFileSync(SCENE, "utf8"));
    const found = new Set();
    const walk = (node) => {
        if (Array.isArray(node)) {
            for (const n of node) walk(n);
            return;
        }
        if (node === null || typeof node !== "object") return;
        for (const [k, v] of Object.entries(node)) {
            if (typeof v === "string") {
                if ((k === "text" || k === "label") && !v.includes("{{")) found.add(v);
                continue;
            }
            walk(v);
        }
    };
    walk(scene);
    return { scene, found };
}

const { scene, found } = harvestSceneLiterals();

const pairs = JSON.parse(readFileSync(PAIRS, "utf8")).pairs;
const dupes = new Map();
for (const p of pairs) {
    if (dupes.has(p.key)) throw new Error("duplicate message key " + p.key);
    dupes.set(p.key, p.text);
}
if (dupes.size !== pairs.length) throw new Error("duplicate message keys in textkeys.json");

// Keyboard characters, harvested from the spec so the key caps and the query
// bar can both be rendered from real entries.
const chars = new Set();
for (const row of scene.keyboard.rows) for (const c of row) chars.add(c);
chars.add(" ");

// ---------------------------------------------------------------------------
// Assign keys and collect every (key, text) pair for strings.json.
// ---------------------------------------------------------------------------
const strings = {};
const problems = [];
const put = (key, text) => {
    if (Object.prototype.hasOwnProperty.call(strings, key)) {
        problems.push(`duplicate key ${key}`);
        return;
    }
    strings[key] = text;
};

const staticKeys = {};
let n = 0;
for (const [name, text] of Object.entries(STATIC)) {
    const key = "sxS" + String(n++).padStart(2, "0");
    staticKeys[name] = key;
    put(key, text);
}
const templateKeys = {};
for (const [name, text] of Object.entries(TEMPLATES)) {
    const key = "sxT" + String(n++).padStart(2, "0");
    templateKeys[name] = key;
    put(key, text);
}
const charKeys = {};
for (const c of [...chars].sort()) {
    const key = "sxC" + String(n++).padStart(2, "0");
    charKeys[c] = key;
    put(key, c);
}
const sceneKeys = {};
for (const lit of [...found].sort()) {
    const key = "sxN" + String(n++).padStart(2, "0");
    sceneKeys[lit] = key;
    put(key, lit);
}
for (const p of pairs) put(p.key, p.text);

// ---------------------------------------------------------------------------
// Validate. Portal's font cannot render these, and an empty value is a blank
// widget that looks exactly like a layout bug in game.
// ---------------------------------------------------------------------------
for (const [key, text] of Object.entries(strings)) {
    if (text === "") problems.push(`${key} has an empty value`);
    for (const ch of text) {
        const c = ch.codePointAt(0);
        if (c < 0x20 || c > 0x7e) {
            problems.push(`${key} has non-ASCII U+${c.toString(16).toUpperCase()} in ${JSON.stringify(text)}`);
            break;
        }
    }
    if (text.length > 120) problems.push(`${key} is ${text.length} chars; long labels are clipped in game`);
}

if (problems.length > 0) {
    console.error("  TEXT BUGS:");
    for (const p of problems.slice(0, 20)) console.error("    - " + p);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit the typed map. Anything referenced as T.<name> in the UI that is missing
// here is a compile error, which is the whole point.
// ---------------------------------------------------------------------------
const L = [];
L.push("// GENERATED by tools/gen-text.mjs -- do not edit by hand.");
L.push("//");
L.push("// Every value is a key into strings.json. mod.Message() looks the key up and");
L.push("// renders the value; a key with no entry renders as <unknown string>.");
L.push("");
L.push("/** strings.json key for each curated label. */");
L.push("export const T = {");
for (const [name, key] of Object.entries(staticKeys)) L.push(`    ${name}: ${q(key)},`);
L.push("} as const;");
L.push("");
L.push("/** Format templates, for composed strings. */");
L.push("export const TPL = {");
for (const [name, key] of Object.entries(templateKeys)) L.push(`    ${name}: ${q(key)},`);
L.push("} as const;");
L.push("");
L.push("/** key for a single keyboard character */");
L.push("export const CHAR_KEY: Readonly<Record<string, string>> = {");
for (const [c, key] of Object.entries(charKeys)) L.push(`    ${q(c)}: ${q(key)},`);
L.push("};");
L.push("");
L.push("/** key for a literal that comes straight out of scene.json */");
L.push("export const SCENE_TEXT: Readonly<Record<string, string>> = {");
for (const [lit, key] of Object.entries(sceneKeys)) L.push(`    ${q(lit)}: ${q(key)},`);
L.push("};");
L.push("");
L.push("export type StaticLabel = keyof typeof T;");
writeFileSync(OUT_TS, L.join("\n"), "utf8");

// strings.json, sorted so the uploaded file is stable and diffable.
const sorted = {};
for (const k of Object.keys(strings).sort()) sorted[k] = strings[k];
writeFileSync(OUT_JSON, JSON.stringify(sorted, null, 4) + "\n", "utf8");

console.log(`  strings : ${Object.keys(sorted).length} keys`);
console.log(`             ${pairs.length} from the catalog, ${Object.keys(staticKeys).length} labels, ${Object.keys(charKeys).length} chars, ${Object.keys(sceneKeys).length} from scene.json`);
console.log(`  wrote ${OUT_TS}`);
console.log(`  wrote ${OUT_JSON}`);
