// Behaviour test for QR CODE on the FAVOURITES tab.
//
// Console players cannot open PortalLog.txt, so EXPORT FAVOURITES does nothing for
// them. QR CODE shows the favourites as QR codes holding plain text: a phone camera
// shows the names, and the player copies them. No website is involved.
//
// This replays dist/bundle.ts and checks:
//   - with no favourites the button does nothing;
//   - the code drawn on screen is exactly the QR of the text the mod meant to show
//     (rebuilt square by square from the drawn rectangles and compared with the
//     bf6-portal-utils encoder's own matrix for that text);
//   - that text is the EXPORT list: asset names, then template lines, in order,
//     under a "SFX/VFX SHOWCASE FAVOURITES i/n" header;
//   - a long list is split into parts that each fit one code, < and > page through
//     them, and together they hold every line once;
//   - the panel covers the browser while it is open;
//   - CLOSE QR, and gadget fire (which closes the menu), delete every QR widget;
//     reopening the menu shows the list, not a stale code;
//   - drawing never creates more than MAX_PER_TICK widgets in one tick.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { ROOT, replay } from "./ui-replay.mjs";

const require = createRequire(resolve(ROOT, "package.json"));
const ts = require("typescript");

const MAX_PER_TICK = 100;
const HEADER = /^SFX\/VFX SHOWCASE FAVOURITES (\d+)\/(\d+)$/;
const QR_BYTES = 718; // version 18 at ECC L: the largest code UIQRCode draws
const MARGIN = 4;

// The library's encoder, run in Node: the reference for what a correct code looks like.
const encSrc = readFileSync(resolve(ROOT, "..", "main_resources", "bf6-portal-utils-master", "ui", "components", "qr-code", "encoder.ts"), "utf8");
const encJs = ts.transpileModule(encSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const encMod = { exports: {} };
new Function("module", "exports", "require", encJs)(encMod, encMod.exports, require);
const QREncoder = encMod.exports.QREncoder;

const TEXT_GEN = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
function labelKey(field) {
    const m = new RegExp(`\\b${field}: "(\\w+)"`).exec(TEXT_GEN);
    if (m === null) throw new Error(`text.gen.ts has no label ${field}`);
    return m[1];
}
const FAV_ADD = labelKey("favAdd");
const EXPORT = labelKey("exportFavs");
const PART_OF = labelKey("qrPartOf");
const problems = [];

const s = await replay(readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8"));
let peak = 0;
const stats = [];
const NL = String.fromCharCode(10);
async function ticks(n) {
    for (let i = 0; i < n; i++) {
        const before = s.calls.length;
        await s.ticks(1);
        const made = s.calls.slice(before).filter((c) => /^AddUI/.test(c.name)).length;
        peak = Math.max(peak, made);
    }
}

/** The QR texts the mod logged (DEBUG on), in the order shown. */
const qrTexts = () =>
    s.logs
        .map((l) => /QR TEXT (\d+)\/(\d+): (.*)$/.exec(l))
        .filter((m) => m !== null)
        .map((m) => ({ part: Number(m[1]), of: Number(m[2]), text: JSON.parse(m[3]) }));

/**
 * Rebuilds the drawn QR from AddUIContainer calls made since `from`: the
 * container with the most children holds the module rectangles. Returns the
 * module grid (n x n, quiet zone stripped) and the container's size.
 */
function drawnGrid(from, n) {
    const made = s.calls.slice(from).filter((c) => c.name === "AddUIContainer");
    const kids = {};
    for (const c of made) {
        const p = c.args[4]?.widget;
        if (p !== undefined) (kids[p] ??= []).push(c);
    }
    const holder = Object.keys(kids).sort((a, b) => kids[b].length - kids[a].length)[0];
    if (holder === undefined) return undefined;
    const box = made.find((c) => c.args[0] === holder);
    const size = box?.args[2]?.v ?? [0, 0];
    const cell = size[0] / (n + 2 * MARGIN);
    const grid = Array.from({ length: n }, () => new Array(n).fill(false));
    for (const r of kids[holder]) {
        const [x, y] = r.args[1].v;
        const [w, h] = r.args[2].v;
        const c0 = Math.round(x / cell) - MARGIN;
        const r0 = Math.round(y / cell) - MARGIN;
        const cw = Math.round(w / cell);
        const rh = Math.round(h / cell);
        for (let rr = r0; rr < r0 + rh; rr++) for (let cc = c0; cc < c0 + cw; cc++) if (rr >= 0 && rr < n && cc >= 0 && cc < n) grid[rr][cc] = true;
    }
    // The code's own widgets: its base container, the module holder and the
    // rectangles. The panel's backdrop and buttons are hidden, not deleted.
    const base = box?.args[4]?.widget;
    const names = [holder, ...kids[holder].map((c) => c.args[0])];
    if (base !== undefined && made.some((c) => c.args[0] === base)) names.push(base);
    return { grid, size, names, rects: kids[holder].length };
}

/** Draws were complete when the expected matrix matches; returns a problem or "". */
function checkDrawn(label, from, text) {
    const want = QREncoder.encode(text, "L");
    if (want === null) return `${label}: the text does not fit one QR code (${Buffer.byteLength(text)} bytes)`;
    const got = drawnGrid(from, want.length);
    if (got === undefined) return `${label}: no QR code was drawn`;
    let wrong = 0;
    for (let r = 0; r < want.length; r++) for (let c = 0; c < want.length; c++) if (want[r][c] !== got.grid[r][c]) wrong++;
    if (wrong > 0) return `${label}: the drawn code differs from the QR of its text in ${wrong} of ${want.length * want.length} squares`;
    if (got.size[0] < 900) return `${label}: the code is ${got.size[0]} px wide; it should fill the screen height (at least 900)`;
    return "";
}

const deleted = () => new Set(s.calls.filter((c) => c.name === "DeleteUIWidget").map((c) => c.args[0]?.widget));
function leftovers(names) {
    const gone = deleted();
    return names.filter((n) => !gone.has(n));
}

/** The EXPORT list as the QR should carry it: asset names, then template lines. */
async function exportLines() {
    const from = s.logs.length;
    s.clickText(EXPORT);
    await ticks(5);
    const log = s.logs.slice(from).map((l) => l.replace(/^<SfxVfxShowcase> /, ""));
    const a = log.findIndex((l) => l.startsWith("---- FAVOURITES"));
    const b = log.findIndex((l) => l.startsWith("---- END FAVOURITES"));
    return log.slice(a + 1, b).map((l) => (/ TEMPLATE \d+ \| /.test(l) ? l : l.split(" | ")[0]));
}

const listVisible = () => s.visibleTexts().some((t) => t.msg[0] === FAV_ADD || t.msg[0] === labelKey("play"));

try {
    s.start();
    await ticks(5);
    s.deploy();
    await ticks(40);
    s.aim();
    await ticks(40);
    s.clickId("btnDebug");
    await ticks(20);

    // ---- no favourites: nothing to show
    s.click("FAVOURITES");
    await ticks(40);
    let mark = s.calls.length;
    s.clickId("btnQr");
    await ticks(120);
    if (qrTexts().length > 0 || drawnGrid(mark, 21) !== undefined) problems.push("QR CODE with no favourites drew a code");

    // ---- a mixed shortlist: sounds, an effect, a screen effect, two templates
    s.click("SOUND");
    await ticks(40);
    for (const row of [2, 1, 0]) {
        s.clickText(FAV_ADD, row);
        await ticks(10);
    }
    s.click("VISUAL");
    await ticks(40);
    for (const row of [5, 0]) {
        s.clickText(FAV_ADD, row);
        await ticks(10);
    }
    s.click("MUSIC");
    await ticks(60);
    s.clickId("mtSave");
    await ticks(10);
    s.click("RADIO");
    await ticks(60);
    s.clickId("mtSave");
    await ticks(10);
    s.click("FAVOURITES");
    await ticks(40);
    const want = await exportLines();
    if (want.length !== 7) problems.push(`setup: EXPORT listed ${want.length} favourites, expected 7`);

    mark = s.calls.length;
    s.clickId("btnQr");
    await ticks(200);
    let shown = qrTexts();
    const first = shown[shown.length - 1];
    if (first === undefined) problems.push("QR CODE logged no QR text (is DEBUG logging of the text missing?)");
    else {
        const lines = first.text.split("\n");
        if (!HEADER.test(lines[0]) || lines[0] !== "SFX/VFX SHOWCASE FAVOURITES 1/1") problems.push(`the code's first line is ${JSON.stringify(lines[0])}, expected "SFX/VFX SHOWCASE FAVOURITES 1/1"`);
        if (JSON.stringify(lines.slice(1)) !== JSON.stringify(want)) problems.push(`the code holds ${JSON.stringify(lines.slice(1))}\n        EXPORT lists ${JSON.stringify(want)}`);
        const p = checkDrawn("mixed list", mark, first.text);
        if (p !== "") problems.push(p);
        const g = drawnGrid(mark, QREncoder.encode(first.text, "L").length);
        stats.push(`${want.length} lines, ${Buffer.byteLength(first.text)} bytes: ${QREncoder.encode(first.text, "L").length} squares wide, ${g?.rects} rectangles`);
    }
    if (listVisible()) problems.push("the favourites list still shows while the QR panel is open");
    if (!s.visibleTexts().some((t) => t.msg[0] === PART_OF && t.msg[1] === 1 && t.msg[2] === 1)) problems.push("the panel does not show QR 1 / 1");

    // ---- CLOSE QR deletes every widget the code made and brings the list back
    const firstNames = drawnGrid(mark, 21)?.names ?? [];
    s.clickId("btnQrClose");
    await ticks(200);
    const left = leftovers(firstNames);
    if (left.length > 0) problems.push(`CLOSE QR left ${left.length} of ${firstNames.length} QR widgets undeleted`);
    if (!listVisible()) problems.push("CLOSE QR did not bring the favourites list back");

    // ---- a long shortlist splits into parts
    s.click("SOUND");
    await ticks(40);
    for (let page = 0; page < 5; page++) {
        for (let row = 7; row >= 0; row--) {
            try {
                s.clickText(FAV_ADD, row);
            } catch {
                continue;
            }
            await ticks(4);
        }
        s.clickId("btnNext");
        await ticks(30);
    }
    s.click("FAVOURITES");
    await ticks(40);
    const all = await exportLines();
    const before = qrTexts().length;
    mark = s.calls.length;
    s.clickId("btnQr");
    await ticks(200);
    shown = qrTexts().slice(before);
    const of = shown[0]?.of ?? 0;
    if (of < 2) problems.push(`${all.length} favourites made ${of} part(s); expected at least 2`);
    const parts = [shown[0]];
    let p1 = shown[0] !== undefined ? checkDrawn("long list part 1", mark, shown[0].text) : "no part 1";
    if (p1 !== "") problems.push(p1);
    for (let i = 2; i <= of; i++) {
        const m2 = s.calls.length;
        const n0 = qrTexts().length;
        s.clickId("btnQrNext");
        await ticks(200);
        const t = qrTexts()[n0];
        if (t === undefined || t.part !== i) {
            problems.push(`> did not show part ${i} of ${of}`);
            break;
        }
        parts.push(t);
        const p = checkDrawn(`long list part ${i}`, m2, t.text);
        if (i === 2) stats.push(`full part: ${Buffer.byteLength(t.text)} bytes, ${t.text.split(NL).length - 1} lines: ${drawnGrid(m2, QREncoder.encode(t.text, "L").length)?.rects} rectangles`);
        if (p !== "") problems.push(p);
        const old = drawnGrid(mark, 21)?.names ?? [];
        if (i === 2 && leftovers(old).length > 0) problems.push("> left the previous part's widgets undeleted");
    }
    const joined = parts.filter(Boolean).flatMap((t) => t.text.split("\n").slice(1));
    if (JSON.stringify(joined) !== JSON.stringify(all)) problems.push(`the parts together hold ${joined.length} lines; EXPORT lists ${all.length}, or the order differs`);
    for (const t of parts.filter(Boolean)) {
        if (Buffer.byteLength(t.text) > QR_BYTES) problems.push(`part ${t.part} is ${Buffer.byteLength(t.text)} bytes, over ${QR_BYTES}`);
        if (t.text.split("\n")[0] !== `SFX/VFX SHOWCASE FAVOURITES ${t.part}/${t.of}`) problems.push(`part ${t.part} header is ${JSON.stringify(t.text.split("\n")[0])}`);
    }
    if (of >= 2) {
        const n0 = qrTexts().length;
        s.clickId("btnQrPrev");
        await ticks(200);
        const t = qrTexts()[n0];
        if (t === undefined || t.part !== of - 1) problems.push(`< from part ${of} did not show part ${of - 1}`);
    }

    // ---- gadget fire closes the menu, which deletes the code; reopening shows the list
    s.clickId("btnQrClose");
    await ticks(200);
    s.click("SOUND");
    await ticks(40);
    s.clickText(labelKey("select"), 0);
    await ticks(10);
    s.click("FAVOURITES");
    await ticks(40);
    const m3 = s.calls.length;
    s.clickId("btnQr");
    await ticks(200);
    const names = drawnGrid(m3, 21)?.names ?? [];
    if (names.length === 0) problems.push("reopening QR CODE drew nothing");
    s.emit("OnPortalGadgetFireStart", s.player);
    await ticks(200);
    const l = leftovers(names);
    if (l.length > 0) problems.push(`closing the menu with gadget fire left ${l.length} of ${names.length} QR widgets undeleted`);
    s.aim();
    await ticks(60);
    if (!listVisible()) problems.push("reopening the menu after gadget fire did not show the favourites list (stale QR panel?)");

    if (peak > MAX_PER_TICK) problems.push(`one tick created ${peak} widgets (limit ${MAX_PER_TICK})`);
    for (const l of s.logs) if (/UNHANDLED ACTION|error|exception/i.test(l)) problems.push("log: " + l);
} finally {
    s.dispose();
}

if (problems.length > 0) {
    console.error("  QR BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
for (const x of stats) console.log("  qr      : " + x);
console.log(`  qr      : QR CODE draws the EXPORT list as plain-text codes, splits long lists into parts, cleans up on close, peak ${peak} widgets/tick`);
