// Tests for the QR asset-ID mapping: registry rules, the payload codec, and the
// mod's encoder (src/qrexport.ts) against the website's (site/js/codec.js).
// No game replay here; tools/test-qr.mjs runs the real bundle end to end.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./ui-replay.mjs";
import { legacyPayloads, loadEncoder, loadMaps, qrSide, unnumbered } from "./qr-helpers.mjs";
import { assignIds, compareRegistries, idRuns, runLookup, siteMap, validateRegistry } from "./registry.mjs";
import * as codec from "../site/js/codec.js";

const { combineParts, decode, hash, idOf, musicCode, namesOf, numOf, packPayloads, radioCode, toCsv } = codec;
const require = createRequire(resolve(ROOT, "package.json"));
const ts = require("typescript");

const problems = [];
const notes = [];
let checks = 0;
function expect(ok, what) {
    checks++;
    if (!ok) problems.push(what);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { maps, current, index } = loadMaps();
const map = maps[current];
const reg = JSON.parse(readFileSync(resolve(ROOT, "registry", `mapping-${current}.json`), "utf8"));
const byName = new Map(reg.assets.map((e) => [e.kind + ":" + e.name, e.id]));
const idOfAsset = (kind, name) => byName.get(kind + ":" + name);
const catalog = JSON.parse(readFileSync(resolve(ROOT, "src", "catalog.json"), "utf8"));
const SFX = catalog.sfx.entries.map((e) => e.name);
const VFX = catalog.vfx.entries.map((e) => e.name);
const QREncoder = loadEncoder();

/** names (sfx or vfx) -> payloads via the registry, like the mod does. */
function encodeNames(names, opts = {}) {
    const codes = names.map((n) => idOfAsset(SFX.includes(n) ? "sfx" : "vfx", n));
    return packPayloads(codes, { mapping: current, ...opts });
}
const roundTrip = (payloads) => combineParts(payloads.map((p) => decode(p, maps, current)));

// ---------------------------------------------------------------- the published data

expect(validateRegistry(reg).length === 0, `registry/mapping-${current}.json is invalid: ${validateRegistry(reg).join("; ")}`);
expect(index.formats.includes(codec.FORMAT), `site/data/maps.json does not list format ${codec.FORMAT}`);
for (const f of Object.keys(index.mappings))
    expect(existsSync(resolve(ROOT, "registry", `mapping-${f}.json`)), `site/data/maps.json lists mapping ${f} with no registry file`);
const qrids = readFileSync(resolve(ROOT, "src", "qrids.gen.ts"), "utf8");
expect(new RegExp(`QR_MAPPING = ${current};`).test(qrids), "src/qrids.gen.ts and site/data/maps.json disagree on the current mapping: the mod would write codes the site cannot read");
expect(new RegExp(`QR_FORMAT = ${codec.FORMAT};`).test(qrids), "src/qrids.gen.ts and site/js/codec.js disagree on the format version");
for (const e of reg.assets) {
    const m = map.ids[e.id];
    if (m === undefined || m.n !== e.name || m.k !== e.kind) {
        expect(false, `site map entry ${e.id} does not match the registry (${e.kind}:${e.name})`);
        break;
    }
}
const vendored = resolve(ROOT, "site", "vendor", "jsQR.js");
expect(readFileSync(vendored, "utf8") === readFileSync(require.resolve("jsqr"), "utf8"), "site/vendor/jsQR.js is not the installed jsqr build; copy node_modules/jsqr/dist/jsQR.js over it");

// ---------------------------------------------------------------- Test 1: one asset

{
    const name = "SFX_Alarm";
    const p = encodeNames([name]);
    const r = decode(p[0], maps, current);
    expect(p.length === 1 && r.status === "ok" && same(namesOf(r.items), [name]), `1 single asset: ${name} -> ${p[0]} -> ${JSON.stringify(namesOf(r.items))}`);
    expect(r.items[0].id === idOfAsset("sfx", name), "1 single asset: decoded ID differs from the registry");
    expect(r.formatVersion === 1 && r.mapping === current && r.checkOk, "1 single asset: header fields not read back");
}

// ---------------------------------------------------------------- Test 2: many assets

{
    const all = [...SFX, ...VFX];
    const p = encodeNames(all, { prefix: "https://example.test/x/#" });
    const j = roundTrip(p);
    expect(j.complete && j.listOk && same(namesOf(j.items), all), `2 every asset (${all.length}) across ${p.length} codes: round trip lost or reordered names`);
    expect(p.every((x) => x.length <= codec.QR_BYTES), "2 every asset: a part is over QR_BYTES");
    expect(p.every((x) => QREncoder.encode(x, "L") !== null), "2 every asset: a part does not fit a QR code");
    const out = [p[2], p[0]].map((x) => decode(x, maps, current));
    const partial = combineParts(out);
    expect(!partial.complete && partial.missing.includes(2), "2 parts: a missing part is not reported");
    notes.push(`every asset: ${all.length} names in ${p.length} codes`);
}

// ---------------------------------------------------------------- Test 3: duplicates

{
    const a = idOfAsset("sfx", SFX[0]);
    const b = idOfAsset("vfx", VFX[0]);
    const p = packPayloads([a, a, b, a], { mapping: current });
    const r = decode(p[0], maps, current);
    expect(same(namesOf(r.items), [SFX[0], SFX[0], VFX[0], SFX[0]]), `3 duplicates: order or count changed: ${JSON.stringify(namesOf(r.items))}`);
    expect(same(r.items.map((i) => i.repeat), [undefined, 2, undefined, 3]), "3 duplicates: repeats are not numbered");
    expect(r.stats.repeated === 2 && r.status === "ok", "3 duplicates: repeats counted wrong or flagged as an error");
}

// ---------------------------------------------------------------- Test 4: unknown ID

{
    const a = idOfAsset("sfx", SFX[0]);
    const b = idOfAsset("sfx", SFX[1]);
    const p = packPayloads([a, "ZZZ", b], { mapping: current });
    const r = decode(p[0], maps, current);
    expect(r.items.length === 3 && r.items[1].status === "unknown" && r.items[1].id === "ZZZ", "4 unknown ID: dropped or not marked unknown");
    expect(/Unknown asset ID ZZZ/.test(r.items[1].note ?? ""), "4 unknown ID: no diagnostic note");
    expect(r.items[0].name === SFX[0] && r.items[2].name === SFX[1], "4 unknown ID: neighbours not decoded");
    expect(r.status === "warning" && r.stats.unknown === 1, "4 unknown ID: status should be warning with 1 unknown");
    const ev = Object.entries(map.ids).find(([, e]) => e.k === "music-event")[0];
    const r2 = decode(packPayloads([ev], { mapping: current })[0], maps, current);
    expect(r2.items[0].status === "unknown", "4 a music-event ID in the asset list must not read as an asset");
}

// ---------------------------------------------------------------- Test 5: corrupt and invalid payloads

{
    const good = encodeNames([SFX[0], SFX[1], VFX[0]])[0];
    const body = good.split(".")[4];
    const flipped = good.replace(body, body.slice(0, 3) + (body[3] === "0" ? "1" : "0") + body.slice(4));
    const cases = [
        ["corrupt", flipped, "one changed character"],
        ["corrupt", good.slice(0, -3), "truncated checksum"],
        ["corrupt", good.slice(0, 20), "truncated header"],
        ["unsupported-format", "SV2.1.1-1.AAAA.000.BBBB", "format 2"],
        ["unsupported-mapping", (() => { const h = "SV1.9.1-1." + hash("000") + ".000"; return h + "." + hash(h); })(), "mapping 9"],
        ["malformed-id", (() => { const h = "SV1." + current + ".1-1." + hash("00001") + ".00001"; return h + "." + hash(h); })(), "cut-short ID"],
        ["too-large", "SV1.1.1-1.AAAA." + "0".repeat(5000) + ".BBBB", "oversized"],
        ["empty", "   ", "empty"],
        ["unsupported-format", "\u0000\u0001", "binary noise"],
        ["unsupported-format", "https://example.com/some/other/page", "another site's QR"],
        ["unsupported-format", "Hello there", "unrelated text"],
    ];
    for (const [code, text, label] of cases) {
        let r;
        try {
            r = decode(text, maps, current);
        } catch (e) {
            expect(false, `5 ${label}: decode threw ${e}`);
            continue;
        }
        const codes = [...r.errors, ...r.warnings].map((e) => e.code);
        expect(codes.includes(code), `5 ${label}: expected ${code}, got ${JSON.stringify(codes)}`);
        expect(r.status !== "ok", `5 ${label}: status ok`);
    }
    const bad = (() => { const h = "SV1." + current + ".1-1." + hash("0I0") + ".0I0"; return h + "." + hash(h); })();
    const r = decode(bad, maps, current);
    expect(r.items[0]?.status === "malformed", "5 an ID with a letter outside the alphabet is not marked malformed");
    const via = decode(encodeNames([SFX[0]], { prefix: "https://x.test/p/#" })[0].replace("#", "#").replace(/\./g, "%2E"), maps, current);
    expect(via.status === "ok", "5 a percent-encoded URL does not decode");
}

// ---------------------------------------------------------------- Tests 6 and 7: mapping versions

{
    // A made-up mapping 2 where the same IDs mean other things: codes made under
    // mapping 1 must keep decoding with mapping 1's table once 2 is current.
    const v2 = { mapping: 2, next: 2, ids: { "000": { k: "vfx", n: "V2_Only_Asset" }, "001": { k: "sfx", n: "V2_Other" } } };
    const both = { ...maps, 2: v2 };
    const old = encodeNames([SFX[0], SFX[1]])[0];
    const r1 = decode(old, both, 2);
    expect(r1.mapping === current && same(namesOf(r1.items), [SFX[0], SFX[1]]), "6 an old mapping-1 code decodes differently once mapping 2 exists");
    const r2 = decode(packPayloads(["000", "001"], { mapping: 2 })[0], both, 2);
    expect(r2.mapping === 2 && same(namesOf(r2.items), ["V2_Only_Asset", "V2_Other"]), "7 a mapping-2 code does not decode with mapping 2");

    // Golden codes: made once and frozen. If one ever decodes differently, a
    // published ID changed meaning, which the registry rules forbid.
    const GOLDEN = [
        ["https://kurtinthe-grind.github.io/SfxVfxShowcase/#SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8", ["FX_ArtilleryStrike_Explosion_01", "FX_BASE_Sparks_Pulse_L", "FX_BASE_Smoke_Pillar_Black_L", "FX_BASE_Fire_M_NoSmoke"]],
    ];
    for (const [text, names] of GOLDEN) {
        const r = decode(text, maps, current);
        expect(r.status === "ok" && same(namesOf(r.items), names), `6 golden code ${text} now decodes to ${JSON.stringify(namesOf(r.items))}`);
    }
}

// ---------------------------------------------------------------- Test 8: legacy codes

{
    const names = [SFX[0], VFX[3], SFX[5]];
    const old = legacyPayloads([...names, "Night Vision", "MUSIC TEMPLATE 1 | Core | Core_LastPhaseBegin | Core_IsWinning 0 | volume 1"]);
    const r = decode(old[0], maps, current);
    expect(r.kind === "legacy" && r.status === "warning", `8 legacy code read as ${r.kind}/${r.status}`);
    expect(same(namesOf(r.items).slice(0, 4), [...names, "Night Vision"]), `8 legacy names: ${JSON.stringify(namesOf(r.items))}`);
    expect(r.items[0].id === idOfAsset("sfx", names[0]) && r.items[3].id === idOfAsset("screen", "night"), "8 legacy names are not matched to their IDs");
    expect(r.items[4].type === "template", "8 legacy template line not kept");
    const log = ["<SfxVfxShowcase> ---- FAVOURITES (2) ----", `<SfxVfxShowcase> ${SFX[0]} | Alarm | SFX | LOOP`, "<SfxVfxShowcase> Not_A_Real_Asset | X | VFX", "<SfxVfxShowcase> ---- END FAVOURITES ----"].join("\n");
    const r2 = decode(log, maps, current);
    expect(same(namesOf(r2.items), [SFX[0], "UNKNOWN Not_A_Real_Asset"]), `8 pasted EXPORT log: ${JSON.stringify(namesOf(r2.items))}`);
    const bare = decode(`${idOfAsset("sfx", SFX[0]).toLowerCase()}, ${idOfAsset("sfx", SFX[1])}`, maps, current);
    expect(bare.kind === "bare" && same(namesOf(bare.items), [SFX[0], SFX[1]]), "8 bare typed IDs do not decode");
}

// ---------------------------------------------------------------- Tests 9 and 10: stability and removal

{
    const cur = [...SFX.map((n) => ({ kind: "sfx", name: n })), ...VFX.map((n) => ({ kind: "vfx", name: n }))];
    const base = assignIds({ mapping: 1, alphabet: codec.ALPHABET, width: 3, next: 0, assets: [] }, cur).registry;
    const before = new Map(base.assets.map((e) => [e.name, e.id]));

    // 9: a new asset sorted first must not shift anyone.
    const grown = assignIds(base, [{ kind: "sfx", name: "SFX_AAA_New_First" }, ...cur]);
    expect(grown.added.length === 1 && grown.added[0].id === idOf(base.next), "9 a new asset did not get the next unused ID");
    expect(grown.registry.assets.every((e) => e.name === "SFX_AAA_New_First" || before.get(e.name) === e.id), "9 adding an asset changed an existing ID");
    expect(compareRegistries(base, grown.registry).length === 0, `9 compareRegistries rejects a pure addition: ${compareRegistries(base, grown.registry)}`);
    const again = assignIds(grown.registry, [{ kind: "sfx", name: "SFX_AAA_New_First" }, ...cur]);
    expect(again.added.length === 0 && same(again.registry, grown.registry), "9 regenerating with no catalog change is not a no-op");

    // Catalog index -> ID through runs, after the insertion.
    const names = ["SFX_AAA_New_First", ...SFX];
    const nums = names.map((n) => numOf(grown.registry.assets.find((e) => e.kind === "sfx" && e.name === n).id));
    const runs = idRuns(nums);
    expect(nums.every((n, i) => runLookup(runs, i) === n), "9 idRuns/runLookup do not reproduce the IDs");
    expect(runs.length === 4, `9 one insertion should make 2 runs, got ${runs.length / 2}`);

    // 10: removal retires; the ID is never reused; a returning asset gets it back.
    const gone = SFX[10];
    const less = assignIds(grown.registry, cur.filter((c) => c.name !== gone).concat([{ kind: "vfx", name: "FX_Brand_New" }]));
    const ret = less.registry.assets.find((e) => e.name === gone);
    expect(ret.status === "retired" && ret.id === before.get(gone), "10 a removed asset was not retired under its ID");
    expect(less.added[0].id !== ret.id && numOf(less.added[0].id) === grown.registry.next, "10 a new asset reused a retired ID");
    expect(compareRegistries(grown.registry, less.registry).length === 0, "10 retiring an asset is flagged as a breaking change");
    const back = assignIds(less.registry, cur.concat([{ kind: "vfx", name: "FX_Brand_New" }]));
    expect(back.revived.length === 1 && back.registry.assets.find((e) => e.name === gone).status === "active", "10 a returning asset was not revived under its old ID");
    const sm = siteMap(less.registry, new Map(), { channels: [], biomes: [] });
    const r = decode(packPayloads([ret.id], { mapping: 1 })[0], { 1: sm }, 1);
    expect(r.items[0].status === "retired" && r.items[0].name === gone && r.status === "ok", "10 a retired ID does not decode to its old name");

    // Validation and history rules the build enforces.
    const dupId = { ...base, assets: [...base.assets, { id: base.assets[0].id, kind: "sfx", name: "X", status: "active" }] };
    expect(validateRegistry(dupId).some((m) => /used twice/.test(m)), "validation: duplicate ID not caught");
    const twoIds = { ...base, next: base.next + 1, assets: [...base.assets, { id: idOf(base.next), kind: "sfx", name: SFX[0], status: "active" }] };
    expect(validateRegistry(twoIds).some((m) => /two IDs/.test(m)), "validation: one asset with two IDs not caught");
    const badId = { ...base, assets: [{ id: "0I0", kind: "sfx", name: "X", status: "active" }] };
    expect(validateRegistry(badId).some((m) => /invalid ID/.test(m)), "validation: invalid ID not caught");
    const over = { ...base, next: 5 };
    expect(validateRegistry(over).some((m) => /not below next/.test(m)), "validation: ID at or above next not caught");
    const swapped = { ...base, assets: base.assets.map((e, i) => (i === 0 ? { ...e, name: "Something_Else" } : e)) };
    expect(compareRegistries(base, swapped).some((m) => /changed meaning/.test(m)), "history: a changed meaning not caught");
    const deleted = { ...base, assets: base.assets.slice(1) };
    expect(compareRegistries(base, deleted).some((m) => /deleted/.test(m)), "history: a deleted entry not caught");
    const rewound = { ...base, next: base.next - 1, assets: base.assets.slice(0, -1) };
    expect(compareRegistries(base, rewound).some((m) => /went back/.test(m)), "history: next going back not caught");
}

// ---------------------------------------------------------------- templates

{
    const ev = (n) => idOfAsset("music-event", n);
    const pm = (n) => idOfAsset("music-param", n);
    const music = musicCode(ev("Core_LastPhaseBegin"), [[pm("Core_IsWinning"), 0], [pm("Core_PhaseUrgency"), 0.5], [pm("Core_Amplitude"), 1.2]]);
    const radio = radioCode([[pm("Radio_Biome"), 0], [pm("Radio_Channel"), 2], [pm("Radio_ContinueQueueOnTrackEnd"), 1], [pm("Radio_LoopQueuedTracks"), 0], [pm("Radio_Amplitude"), 1]], [[2, 0, 3], [4, 1, 7]]);
    const r = decode(packPayloads([idOfAsset("sfx", SFX[0]), music, radio], { mapping: current })[0], maps, current);
    const lines = namesOf(r.items);
    expect(lines[1] === "MUSIC TEMPLATE 1 | Core | Core_LastPhaseBegin | Core_IsWinning 0, Core_PhaseUrgency 0.5 | volume 1.2", `templates: music line ${lines[1]}`);
    expect(lines[2] === "RADIO TEMPLATE 2 | channel 2 BF Themes | queue BF Themes #3, Tajikistan #7 | continue 1, loop 0 | volume 1", `templates: radio line ${lines[2]}`);
    // A huge radio queue is cut at a pick so the code still fits one QR.
    const big = radioCode([[pm("Radio_Channel"), 1]], Array.from({ length: 200 }, (_, i) => [1, 0, i]));
    const p = packPayloads([big], { mapping: current, prefix: "https://kurtinthe-grind.github.io/SfxVfxShowcase/#" });
    const rb = decode(p[0], maps, current);
    expect(p.length === 1 && p[0].length <= codec.QR_BYTES && rb.status === "ok" && rb.items[0].queue.length > 50, "templates: an oversized radio queue does not fit or decode");
}

// ---------------------------------------------------------------- the mod's encoder == the codec

{
    const src = readFileSync(resolve(ROOT, "src", "qrexport.ts"), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const m = { exports: {} };
    new Function("module", "exports", "require", js)(m, m.exports, (p) => (p === "./qrids.gen" ? { QR_FORMAT: codec.FORMAT, QR_MAPPING: current } : require(p)));
    const mod = m.exports;
    let seed = 7;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    let mismatches = 0;
    for (let trial = 0; trial < 200; trial++) {
        const codes = Array.from({ length: rnd(400) }, () => idOf(rnd(1308)));
        if (rnd(3) === 0) codes.push(radioCode([["18Q", rnd(3)]], Array.from({ length: rnd(150) }, () => [rnd(7), rnd(7), rnd(30)])));
        const prefix = rnd(2) === 0 ? "" : "https://kurtinthe-grind.github.io/SfxVfxShowcase/#";
        if (!same(mod.packQrPayloads(codes, prefix), packPayloads(codes, { mapping: current, prefix }))) mismatches++;
    }
    expect(mismatches === 0, `parity: src/qrexport.ts and site/js/codec.js packed ${mismatches} of 200 random lists differently`);
    expect([0, 1, 31, 32, 1307, 32767].every((n) => mod.qrId(n) === idOf(n)), "parity: qrId differs from codec idOf");
    expect([0, 0.5, 1.25, 3, 0.1 + 0.2].every((v) => mod.qrNum(v) === codec.numText(v)), "parity: qrNum differs from codec numText");
    const runs = [0, 0, 5, 900, 9, 10];
    expect([0, 4, 5, 8, 9, 20].every((i) => mod.runId(runs, i) === runLookup(runs, i)), "parity: runId differs from runLookup");
}

// ---------------------------------------------------------------- Test 11: payload size

{
    const groups = new Map();
    for (const e of [...catalog.sfx.entries, ...catalog.vfx.entries]) groups.set(e.category, [...(groups.get(e.category) ?? []), e.name]);
    const biggest = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    let seed = 11;
    const pick = (n) => Array.from({ length: n }, () => [...SFX, ...VFX][((seed = (seed * 48271) % 2147483647), seed % (SFX.length + VFX.length))]);
    const lists = [
        ["4 demo effects", ["FX_ArtilleryStrike_Explosion_01", "FX_BASE_Sparks_Pulse_L", "FX_BASE_Smoke_Pillar_Black_L", "FX_BASE_Fire_M_NoSmoke"]],
        ["12 random assets", pick(12)],
        ["40 random assets", pick(40)],
        [`group ${biggest[0]} (${biggest[1].length})`, biggest[1]],
        [`every asset (${SFX.length + VFX.length})`, [...SFX, ...VFX]],
    ];
    const prefix = "https://kurtinthe-grind.github.io/SfxVfxShowcase/#";
    notes.push("size    : list | full names: codes, bytes, largest code | IDs (+URL): codes, bytes, largest code");
    for (const [label, names] of lists) {
        const old = legacyPayloads(names);
        const now = encodeNames(names, { prefix });
        const ob = old.reduce((n, p) => n + p.length, 0);
        const nb = now.reduce((n, p) => n + p.length, 0);
        const side = (ps) => Math.max(...ps.map((p) => qrSide(QREncoder, p)));
        notes.push(`size    : ${label} | ${old.length}, ${ob} B, ${side(old)} sq | ${now.length}, ${nb} B, ${side(now)} sq | ${Math.round((100 * nb) / ob)}%`);
        if (names.length >= 12) expect(nb < ob * 0.25, `11 ${label}: compact codes are ${nb} bytes vs ${ob}; expected under 25%`);
    }
}

// ---------------------------------------------------------------- exports

{
    const p = encodeNames(["SFX_Alarm", VFX[0]]);
    const csv = toCsv(decode(p[0], maps, current).items);
    expect(csv.split("\n")[0] === "#,type,id,name,kind,group,status" && csv.includes(",SFX_Alarm,sfx,"), "CSV export is malformed");
}

if (problems.length > 0) {
    console.error("  QR MAPPING BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
for (const n of notes) console.log("  mapping " + n);
console.log(`  mapping : ${checks} checks: registry rules, round trips, duplicates, unknown and corrupt codes, mapping versions, legacy codes, templates, mod/codec parity`);
