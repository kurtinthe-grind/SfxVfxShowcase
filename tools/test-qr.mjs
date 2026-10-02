// Behaviour test for QR CODE on the FAVOURITES tab, end to end on dist/bundle.ts.
//
// QR CODE shows the favourites as compact codes: stable asset IDs (registry/) under
// a short header, behind the companion website's URL. A phone camera opens the site,
// which expands the IDs back to full names (site/js/codec.js).
//
// This replays the bundle and checks:
//   - with no favourites the button does nothing;
//   - the demonstration list (an explosion, sparks, smoke, fire) becomes exactly its
//     four IDs, and DEBUG logs each name -> ID;
//   - the code drawn on screen is exactly the QR of the payload (rebuilt square by
//     square and compared with the bf6-portal-utils encoder's matrix);
//   - jsQR reads the drawn code back (what a camera does) and the website's decoder
//     turns it into the EXPORT list: asset names, then template lines, in order;
//   - the mod's payloads match the codec's reference packer byte for byte;
//   - a long list is split into parts that each fit one code, < and > page through
//     them, and the site joins the scanned parts into the full EXPORT list;
//   - CLOSE QR, and gadget fire (which closes the menu), delete every QR widget;
//     reopening the menu shows the list, not a stale code;
//   - drawing never creates more than MAX_PER_TICK widgets in one tick.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";
import { drawnGrid, legacyPayloads, loadEncoder, loadMaps, scanGrid, unnumbered } from "./qr-helpers.mjs";
import { combineParts, decode, namesOf, packPayloads, QR_BYTES } from "../site/js/codec.js";

const MAX_PER_TICK = 100;
const QREncoder = loadEncoder();
const { maps, current } = loadMaps();
const map = maps[current];
const idOfName = new Map(Object.entries(map.ids).map(([id, e]) => [e.n, id]));

const SITE = /qrSite: "([^"]*)"/.exec(readFileSync(resolve(ROOT, "src", "config.ts"), "utf8"))[1];
const PREFIX = SITE === "" ? "" : SITE + "#";

const TEXT_GEN = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
function labelKey(field) {
    const m = new RegExp(`\\b${field}: "(\\w+)"`).exec(TEXT_GEN);
    if (m === null) throw new Error(`text.gen.ts has no label ${field}`);
    return m[1];
}
const CATALOG_TS = readFileSync(resolve(ROOT, "src", "catalog.ts"), "utf8");
function rowKeyOf(name) {
    const m = new RegExp(`name: "${name}",[^\\n]*? key: "(\\w+)"`).exec(CATALOG_TS);
    if (m === null) throw new Error(`catalog.ts has no ${name}`);
    return m[1];
}
const FAV_ADD = labelKey("favAdd");
const EXPORT = labelKey("exportFavs");
const PART_OF = labelKey("qrPartOf");
const DEMO = ["FX_ArtilleryStrike_Explosion_01", "FX_BASE_Sparks_Pulse_L", "FX_BASE_Smoke_Pillar_Black_L", "FX_BASE_Fire_M_NoSmoke"];
const problems = [];
const stats = [];

const s = await replay(readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8"));
let peak = 0;
async function ticks(n) {
    for (let i = 0; i < n; i++) {
        const before = s.calls.length;
        await s.ticks(1);
        const made = s.calls.slice(before).filter((c) => /^AddUI/.test(c.name)).length;
        peak = Math.max(peak, made);
    }
}

/** The QR payloads the mod logged (DEBUG on), in the order shown. */
const qrTexts = () =>
    s.logs
        .map((l) => /QR TEXT (\d+)\/(\d+): (.*)$/.exec(l))
        .filter((m) => m !== null)
        .map((m) => ({ part: Number(m[1]), of: Number(m[2]), text: JSON.parse(m[3]) }));

/** DEBUG "QR MAP name -> code" lines logged since `from`. */
const qrMaps = (from) =>
    s.logs
        .slice(from)
        .map((l) => /QR MAP (.*) -> (\S+)$/.exec(l))
        .filter((m) => m !== null)
        .map((m) => ({ name: m[1], code: m[2] }));

/** Draws were complete when the expected matrix matches; returns { problem, grid }. */
function checkDrawn(label, from, text) {
    const want = QREncoder.encode(text, "L");
    if (want === null) return { problem: `${label}: the payload does not fit one QR code (${Buffer.byteLength(text)} bytes)` };
    const got = drawnGrid(s.calls, from, want.length);
    if (got === undefined) return { problem: `${label}: no QR code was drawn` };
    let wrong = 0;
    for (let r = 0; r < want.length; r++) for (let c = 0; c < want.length; c++) if (want[r][c] !== got.grid[r][c]) wrong++;
    if (wrong > 0) return { problem: `${label}: the drawn code differs from the QR of its payload in ${wrong} of ${want.length * want.length} squares`, got };
    if (got.size[0] < 900) return { problem: `${label}: the code is ${got.size[0]} px wide; it should fill the screen height (at least 900)`, got };
    const scanned = scanGrid(got.grid);
    if (scanned !== text) return { problem: `${label}: a camera scan of the drawn code reads ${JSON.stringify(scanned)}, not the payload`, got };
    return { problem: "", got, scanned };
}

const deleted = () => new Set(s.calls.filter((c) => c.name === "DeleteUIWidget").map((c) => c.args[0]?.widget));
const leftovers = (names) => names.filter((n) => !deleted().has(n));

/** The EXPORT list: asset names, then template lines. */
async function exportLines() {
    const from = s.logs.length;
    s.clickText(EXPORT);
    await ticks(5);
    const log = s.logs.slice(from).map((l) => l.replace(/^<SfxVfxShowcase> /, ""));
    const a = log.findIndex((l) => l.startsWith("---- FAVOURITES"));
    const b = log.findIndex((l) => l.startsWith("---- END FAVOURITES"));
    return log.slice(a + 1, b).map((l) => (/ TEMPLATE \d+ \| /.test(l) ? l : l.split(" | ")[0]));
}

/** Pages VISUAL until the row for `name` shows, then presses its +. */
async function favouriteVfx(name) {
    const key = rowKeyOf(name);
    s.click("VISUAL");
    await ticks(40);
    for (let page = 0; page < 60; page++) {
        const label = s.visibleTexts().find((t) => t.msg[0] === key);
        if (label !== undefined) {
            const pluses = s.visibleTexts().filter((t) => t.msg[0] === FAV_ADD);
            let best = 0;
            pluses.forEach((p, i) => {
                if (Math.abs(p.y - label.y) < Math.abs(pluses[best].y - label.y)) best = i;
            });
            s.clickText(FAV_ADD, best);
            await ticks(10);
            return;
        }
        s.clickId("btnNext");
        await ticks(30);
    }
    throw new Error(`${name} never showed on the VISUAL tab`);
}

const sameList = (a, b) => JSON.stringify(a.map(unnumbered)) === JSON.stringify(b.map(unnumbered));
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
    if (qrTexts().length > 0 || drawnGrid(s.calls, mark, 21) !== undefined) problems.push("QR CODE with no favourites drew a code");

    // ---- the demonstration: four effects -> four IDs -> code -> camera -> site -> names
    for (const n of DEMO) await favouriteVfx(n);
    s.click("FAVOURITES");
    await ticks(40);
    const demoExport = await exportLines();
    if (!sameList(demoExport, DEMO)) problems.push(`demo setup: EXPORT lists ${JSON.stringify(demoExport)}`);
    let logMark = s.logs.length;
    mark = s.calls.length;
    s.clickId("btnQr");
    await ticks(200);
    const demoMap = qrMaps(logMark);
    const demoIds = DEMO.map((n) => idOfName.get(n));
    if (JSON.stringify(demoMap) !== JSON.stringify(DEMO.map((n, i) => ({ name: n, code: demoIds[i] })))) problems.push(`DEBUG QR MAP lines are ${JSON.stringify(demoMap)}, expected each demo name -> its registry ID`);
    const demo = qrTexts().at(-1);
    if (demo === undefined) problems.push("QR CODE logged no QR TEXT (is DEBUG logging of the payload missing?)");
    else {
        if (!demo.text.startsWith(PREFIX + "SV1." + current + ".1-1.")) problems.push(`the demo payload ${JSON.stringify(demo.text)} does not start with ${PREFIX}SV1.${current}.1-1.`);
        const body = demo.text.slice(PREFIX.length).split(".")[4];
        if (body !== demoIds.join("")) problems.push(`the demo body is ${body}, expected ${demoIds.join("")}`);
        const d = checkDrawn("demo", mark, demo.text);
        if (d.problem !== "") problems.push(d.problem);
        const r = decode(d.scanned ?? demo.text, maps, current);
        if (r.status !== "ok" || r.stats.unknown !== 0 || !sameList(namesOf(r.items), DEMO)) problems.push(`the site decodes the demo code to ${r.status} ${JSON.stringify(namesOf(r.items))} ${JSON.stringify(r.errors)}`);
        const legacy = legacyPayloads(DEMO)[0];
        stats.push("demo    : " + DEMO.map((n, i) => `${n} -> ${demoIds[i]}`).join(", "));
        stats.push(`demo    : payload ${JSON.stringify(demo.text)}`);
        stats.push(`demo    : camera read it back, site expanded it to ${namesOf(r.items).join(", ")}`);
        stats.push(`demo    : ${Buffer.byteLength(demo.text)} bytes (${Buffer.byteLength(demo.text) - PREFIX.length} without the URL), ${QREncoder.encode(demo.text, "L").length} squares wide; full names: ${Buffer.byteLength(legacy)} bytes, ${QREncoder.encode(legacy, "L").length} squares`);
    }
    s.clickId("btnQrClose");
    await ticks(200);

    // ---- a mixed shortlist: sounds, effects, two templates
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
    if (want.length !== 11) problems.push(`setup: EXPORT listed ${want.length} favourites, expected 11`);

    logMark = s.logs.length;
    mark = s.calls.length;
    s.clickId("btnQr");
    await ticks(200);
    const first = qrTexts().at(-1);
    const codes = qrMaps(logMark);
    if (!sameList(codes.map((c) => c.name), want)) problems.push(`DEBUG QR MAP names ${JSON.stringify(codes.map((c) => c.name))} differ from EXPORT ${JSON.stringify(want)}`);
    const ref = packPayloads(codes.map((c) => c.code), { mapping: current, prefix: PREFIX });
    if (first === undefined) problems.push("QR CODE logged no QR TEXT for the mixed list");
    else {
        if (JSON.stringify(ref) !== JSON.stringify([first.text])) problems.push(`the mod's payload ${JSON.stringify(first.text)} differs from the codec's ${JSON.stringify(ref)}`);
        const d = checkDrawn("mixed list", mark, first.text);
        if (d.problem !== "") problems.push(d.problem);
        const r = decode(d.scanned ?? first.text, maps, current);
        if (r.status !== "ok" || !sameList(namesOf(r.items), want)) problems.push(`the site decodes the mixed code to ${r.status}:\n        ${JSON.stringify(namesOf(r.items))}\n        EXPORT lists ${JSON.stringify(want)}`);
        const legacy = legacyPayloads(want)[0];
        stats.push(`mixed   : ${want.length} items (2 templates): ${Buffer.byteLength(first.text)} bytes, ${QREncoder.encode(first.text, "L").length} squares wide, ${d.got?.rects} rectangles; full names: ${Buffer.byteLength(legacy)} bytes, ${QREncoder.encode(legacy, "L").length} squares`);
    }
    if (listVisible()) problems.push("the favourites list still shows while the QR panel is open");
    if (!s.visibleTexts().some((t) => t.msg[0] === PART_OF && t.msg[1] === 1 && t.msg[2] === 1)) problems.push("the panel does not show QR 1 / 1");

    // ---- CLOSE QR deletes every widget the code made and brings the list back
    const firstNames = drawnGrid(s.calls, mark, 21)?.names ?? [];
    s.clickId("btnQrClose");
    await ticks(200);
    const left = leftovers(firstNames);
    if (left.length > 0) problems.push(`CLOSE QR left ${left.length} of ${firstNames.length} QR widgets undeleted`);
    if (!listVisible()) problems.push("CLOSE QR did not bring the favourites list back");

    // ---- a long shortlist (about 250 sounds) splits into parts
    s.click("SOUND");
    await ticks(40);
    for (let page = 0; page < 31; page++) {
        for (let row = 7; row >= 0; row--) {
            try {
                s.clickText(FAV_ADD, row);
            } catch {
                continue;
            }
            await ticks(2);
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
    let shown = qrTexts().slice(before);
    const of = shown[0]?.of ?? 0;
    if (of < 2) problems.push(`${all.length} favourites made ${of} part(s); expected at least 2`);
    const parts = [shown[0]];
    const scans = [];
    const d1 = shown[0] !== undefined ? checkDrawn("long list part 1", mark, shown[0].text) : { problem: "no part 1" };
    if (d1.problem !== "") problems.push(d1.problem);
    scans.push(d1.scanned);
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
        const d = checkDrawn(`long list part ${i}`, m2, t.text);
        if (d.problem !== "") problems.push(d.problem);
        scans.push(d.scanned);
        if (i === 2) {
            stats.push(`full    : part 2 of ${of}: ${Buffer.byteLength(t.text)} bytes, ${d.got?.rects} rectangles`);
            if (leftovers(drawnGrid(s.calls, mark, 21)?.names ?? []).length > 0) problems.push("> left the previous part's widgets undeleted");
        }
    }
    for (const t of parts.filter(Boolean)) {
        if (Buffer.byteLength(t.text) > QR_BYTES) problems.push(`part ${t.part} is ${Buffer.byteLength(t.text)} bytes, over ${QR_BYTES}`);
        if (!t.text.startsWith(`${PREFIX}SV1.${current}.${t.part}-${t.of}.`)) problems.push(`part ${t.part} header is ${JSON.stringify(t.text.slice(0, PREFIX.length + 20))}`);
    }
    const decoded = scans.map((x) => decode(x ?? "", maps, current));
    const joined = combineParts(decoded);
    if (!joined.complete || !joined.listOk) problems.push(`the site could not join the ${of} scanned parts (complete ${joined.complete}, list hash ok ${joined.listOk})`);
    if (!sameList(namesOf(joined.items), all)) problems.push(`the joined parts hold ${joined.items.length} items; EXPORT lists ${all.length}, or the order differs`);
    const legacyAll = legacyPayloads(all);
    const newBytes = parts.reduce((n, t) => n + Buffer.byteLength(t.text), 0);
    stats.push(`full    : ${all.length} items: ${of} code(s), ${newBytes} bytes; full names would need ${legacyAll.length} codes, ${legacyAll.reduce((n, t) => n + Buffer.byteLength(t), 0)} bytes`);
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
    const names = drawnGrid(s.calls, m3, 21)?.names ?? [];
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
for (const x of stats) console.log("  qr " + x);
console.log(`  qr      : QR CODE draws compact ID codes that a camera reads back and the site expands to the EXPORT list; long lists split and rejoin; cleans up on close; peak ${peak} widgets/tick`);
