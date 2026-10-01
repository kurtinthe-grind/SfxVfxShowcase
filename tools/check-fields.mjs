// Asserts that every text-carrying field is produced as a mod.Message.
//
// THE BUG CLASS
// mod.Message() is a strings.json lookup, so a field consumed as text has to hold a
// Message. Handing it a bare string yields the placeholder instead, and on screen that
// is indistinguishable from a real label. Two instances so far, both found only by
// reading a pasted in-game log:
//
//   * rawProp()/resolveToken() called String() on the value, turning every Message
//     into "[object Object]" -- logged as MISSING TEXT KEY: "[Message]";
//   * actGlyph carried CONFIG.playGlyph, the literal "P" -- logged as
//     MISSING TEXT KEY: "P".
//
// The browser preview cannot catch either: it has no mod.Message layer, so it renders
// whatever string it is handed. This gate is the substitute.
//
// A field value is accepted when it goes through something that yields a Message, and
// rejected when it does not and is a literal or a bare variable read -- the two shapes
// that actually broke.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const scene = JSON.parse(readFileSync(resolve(ROOT, "src", "scene.json"), "utf8"));
const ui = readFileSync(resolve(ROOT, "src", "ui.ts"), "utf8").replace(/\r\n/g, "\n");
// The MUSIC / RADIO tester's fields are produced by src/tester.ts (testerFields),
// which chromeFields() spreads into the `f` scope.
const testerSrc = readFileSync(resolve(ROOT, "src", "tester.ts"), "utf8").replace(/\r\n/g, "\n");
const cfg = readFileSync(resolve(ROOT, "src", "config.ts"), "utf8").replace(/\r\n/g, "\n");
const gt = readFileSync(resolve(HERE, "gen-text.mjs"), "utf8").replace(/\r\n/g, "\n");
const strings = JSON.parse(readFileSync(resolve(ROOT, "src", "strings.json"), "utf8"));
const problems = [];

// Which field names does the scene consume as text? `sh` is the palette (colours,
// resolved as strings on purpose) so it is excluded.
const TOKEN = /\{\{\s*([A-Za-z_]+)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
const wanted = new Map();

// Scope fields are only ever assigned inside functions that return a Scope
// (railFields, chromeFields, rowFields, ...). Scanning the whole file instead would
// flag bf6-portal-utils' property-style component API -- ensureWidget() writes
// "label: label" when building a UITextButton, which is a component parameter, not
// a field. The old positional API (AddUIText(nm, x, y, ..., label)) had no such
// collision.
function scopeBodies(src) {
    const out = [];
    const re = /^(?:export )?function [A-Za-z0-9_]+\([^)]*\): Scope \{/gm;
    let m;
    while ((m = re.exec(src)) !== null) {
        const end = src.indexOf("\n}\n", re.lastIndex);
        if (end < 0) continue;
        out.push(src.slice(m.index, end));
        re.lastIndex = end;
    }
    return out.join("\n");
}
const uiScopes = scopeBodies(ui) + "\n" + scopeBodies(testerSrc);
const uiCode = ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
// Comments stripped for the same reason: the resolvers explain in prose that
// String() is what breaks them, and a naive scan matches its own warning.
const uiScopeCode = uiScopes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// No value may be stringified on its way out of the field resolvers. String() on an

const note = (scope, name) => {
    if (scope === "sh" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
    if (!wanted.has(name)) wanted.set(name, new Set());
    wanted.get(name).add(scope);
};

const walk = (nodes) => {
    for (const n of Array.isArray(nodes) ? nodes : []) {
        if (n === null || typeof n !== "object") continue;
        if (Array.isArray(n)) {
            walk(n);
            continue;
        }
        for (const [k, v] of Object.entries(n)) {
            if (k === "bind" && v !== null && typeof v === "object") {
                // bind: { "text": "page" } names the field directly, no token.
                if (typeof v.text === "string") {
                    for (const m of v.text.matchAll(TOKEN)) note(m[1], m[2]);
                    if (!TOKEN.test(v.text)) note("f", v.text);
                }
                continue;
            }
            if (typeof v === "string") {
                // A node's own text: either a {{scope.field}} token or a static
                // literal that gen-text.mjs harvests. Only the token is a field.
                if (k === "text") for (const m of v.matchAll(TOKEN)) note(m[1], m[2]);
            } else if (v !== null && typeof v === "object") {
                walk(Array.isArray(v) ? v : [v]);
            }
        }
    }
};
walk(scene.screen);
walk(scene.row);
walk([scene.railRow]);

// A value is fine when it passes through something that yields a Message.
const PRODUCERS =
    /\b(K|S|msgFor|hintFor|activeFilterLabel|bottomKey|chipTextKey|rowTextKey|rowCatTextKey|groupTextKey|charKey|mod\.Message)\s*\(/;

for (const [name, scopes] of wanted) {
    // Comma-terminated only, so a `name: number;` TypeScript annotation on the
    // PlayerUi interface is not mistaken for a field assignment.
    const re = new RegExp("^\\s*" + name + ":\\s*(.+?),\\s*$", "gm");
    let m;
    let seen = false;
    while ((m = re.exec(uiScopeCode)) !== null) {
        const value = m[1].trim();
        seen = true;
        const hasLiteral = /["'`]/.test(value);
        const bareRead = !value.includes("(");
        if (!PRODUCERS.test(value) && (hasLiteral || bareRead)) {
            problems.push(
                "field " +
                    [...scopes].join("/") +
                    "." +
                    name +
                    " is a raw string (" +
                    value +
                    "); wrap it in K() or mod.Message() so it resolves through strings.json"
            );
        }
    }
    // Slot families: f["mtP" + i + "Label"] = ... assigns mtP0Label..mtP<n>Label in
    // a loop. Held to the same rule as a literal assignment: every branch of the
    // value must be a Message producer.
    const slot = name.match(/^([A-Za-z_]+?)(\d+)([A-Za-z_]+)$/);
    if (!seen && slot !== null) {
        const sre = new RegExp('\\[\\s*"' + slot[1] + '" \\+ i \\+ "' + slot[3] + '"\\s*\\]\\s*=\\s*(.+?);\\s*$', "gm");
        while ((m = sre.exec(uiScopeCode)) !== null) {
            seen = true;
            const value = m[1].trim();
            const branches = value.split(/\s[?:]\s/);
            for (const b of branches.slice(branches.length > 1 ? 1 : 0)) {
                if (!PRODUCERS.test(b)) problems.push(`field ${[...scopes].join("/")}.${name} is a raw string (${value}); wrap it in K() or mod.Message()`);
            }
        }
    }
    if (!seen) {
        problems.push(`field ${[...scopes].join("/")}.${name} is consumed as text but never assigned in ui.ts or tester.ts`);
    }
}

// The glyph letters must agree between config.ts and gen-text.mjs.
for (const name of ["playGlyph", "spawnGlyph", "effectGlyph"]) {
    const m = cfg.match(new RegExp(name + ':\\s*"([^"]*)"'));
    const g = gt.match(new RegExp("^\\s*" + name + ':\\s*"([^"]*)"', "m"));
    if (m === null || g === null) {
        problems.push(`cannot read ${name} from config.ts or gen-text.mjs`);
        continue;
    }
    if (m[1] !== g[1]) {
        problems.push(`${name} is "${m[1]}" in config.ts but "${g[1]}" in gen-text.mjs`);
    }
    if (!Object.values(strings).includes(g[1])) {
        problems.push(`glyph "${g[1]}" has no strings.json entry`);
    }
}

// The labelled-button shape, as bf6-portal-utils models it.
//
// The old hand-rolled shape was a UIContainer holding a button plus a text child,
// with the button created last so the label could not sit on top and swallow the
// hit: a UIButton carries no text (AddUIButton's overloads take no message, and
// SetUITextLabel is for UIText), so a label had to be a separate widget. That
// ordering rule existed only because of that split.
//
// UITextButton removes the split entirely -- it carries its own label and its own
// handler in one element -- so the ordering rule is obsolete. What matters now is
// that each labelled widget really is one UITextButton with BOTH a label and a
// handler, and that the old _b/_t scaffolding is gone rather than left dormant.
if (!/import\s*\{\s*UITextButton\s*\}\s*from\s*"bf6-portal-utils\/ui(\/components\/text-button)?"/.test(ui)) {
    problems.push("ui.ts does not import UITextButton from bf6-portal-utils/ui; labelled buttons regressed to the old shape");
}
if (!/new UITextButton\(\{/.test(ui)) {
    problems.push("ui.ts builds no UITextButton, so no labelled clickable element exists");
}
const tbStart = ui.indexOf("new UITextButton({");
if (tbStart >= 0) {
    const tb = ui.slice(tbStart, ui.indexOf("})", tbStart));
    if (!/\blabel:/.test(tb)) problems.push("the UITextButton is built without a label, so it renders blank");
    if (!/\bonClickUp\s*:/.test(tb)) problems.push("the UITextButton is built without onClickUp, so it cannot report a click");
}
for (const legacy of ["AddUIContainer(", "AddUIButton(", "AddUIText("]) {
    if (ui.includes(legacy)) problems.push(`ui.ts still calls ${legacy} from the removed hand-rolled widget layer`);
}

// No value may be stringified on its way out of the field resolvers. String() on an
// opaque Message yields "[object Object]", and this happened three times across two
// rounds: resolveToken(), the bound-field path, and the inline-spec path. The gate
// did not catch the third because the preview has no mod.Message layer, so it is
// asserted here instead.
for (const fn of ["function rawProp(", "function resolveToken("]) {
    const start = uiCode.indexOf(fn);
    if (start < 0) {
        problems.push(`ui.ts is missing ${fn}`);
        continue;
    }
    const end = uiCode.indexOf("\n}\n", start);
    const body = uiCode.slice(start, end);
    if (body.includes("String(")) {
        const line = body.split("\n").find((l) => l.includes("String("));
        problems.push(`${fn} stringifies a resolved value: ${line.trim()}`);
    }
}

// Depth is the one thing that can still bury a working button. bf6-portal-utils
// defaults every element to Depth.AboveGameUI (index.ts: params.depth ??
// Depth.AboveGameUI), so children created without an explicit depth land in the
// same layer as the root -- but only while nobody passes BelowGameUI.
if (/depth:\s*UI\.Depth\.BelowGameUI/.test(uiCode)) {
    problems.push("ui.ts puts an element in UI.Depth.BelowGameUI, which puts it under the game HUD and swallows clicks");
}

if (problems.length > 0) {
    console.error("  FIELD BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log(
    `  fields  : ${wanted.size} text-carrying fields all produce Messages, ` +
        "glyph letters agree with config.ts, labelled buttons are one UITextButton with a label and a handler"
);
