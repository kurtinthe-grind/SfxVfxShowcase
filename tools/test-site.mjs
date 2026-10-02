// Browser test for the companion website (site/), in headless Chromium.
//
// Not part of npm run build: it needs Playwright, which the mod does not. Install
// it once with `npm install --no-save playwright-core && npx playwright-core install chromium`
// (or point PLAYWRIGHT_MODULE at an existing playwright install), then npm run test:site.
//
// Checks, on the page as GitHub Pages would serve it:
//   - a decoder link (what a phone camera opens) shows the full names and metadata;
//   - an uploaded image of the very code the mod draws decodes to the same names;
//   - pasted data: unknown IDs are shown, not dropped; corrupt and foreign codes
//     are refused with a reason; legacy full-name codes still read;
//   - a list split over two codes is joined after both are scanned;
//   - JSON and CSV downloads hold the list; the lookup finds an ID;
//   - nothing overflows a 390 px phone screen, and the console stays clean.

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./ui-replay.mjs";
import { legacyPayloads, loadEncoder, loadMaps, pngOf } from "./qr-helpers.mjs";
import { serveSite } from "./serve-site.mjs";
import { hash, packPayloads } from "../site/js/codec.js";

const require = createRequire(resolve(ROOT, "package.json"));
function loadPlaywright() {
    for (const m of [process.env.PLAYWRIGHT_MODULE, "playwright-core", "playwright"].filter(Boolean)) {
        try {
            return require(m);
        } catch {
            // try the next
        }
    }
    return undefined;
}
const pw = loadPlaywright();
if (pw === undefined) {
    console.log("  site    : SKIPPED, Playwright is not installed (see the header of tools/test-site.mjs)");
    process.exit(0);
}

const SHOTS = process.env.SHOT_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const TMP = resolve(ROOT, "node_modules", ".cache", "test-site");
mkdirSync(TMP, { recursive: true });

const { maps, current } = loadMaps();
const map = maps[current];
const idOf = new Map(Object.entries(map.ids).map(([id, e]) => [e.n, id]));
const DEMO = ["FX_ArtilleryStrike_Explosion_01", "FX_BASE_Sparks_Pulse_L", "FX_BASE_Smoke_Pillar_Black_L", "FX_BASE_Fire_M_NoSmoke"];
const PREFIX = "https://kurtinthe-grind.github.io/SfxVfxShowcase/#";
const demo = packPayloads(DEMO.map((n) => idOf.get(n)), { mapping: current, prefix: PREFIX })[0];
const QREncoder = loadEncoder();

const problems = [];
const expect = (ok, what) => {
    if (!ok) problems.push(what);
};

const server = await serveSite(0);
const browser = await pw.chromium.launch();
const consoleErrors = [];
async function page(width = 1100) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
    });
    p.on("pageerror", (e) => consoleErrors.push(String(e)));
    return p;
}
const names = (p) => p.$$eval("#assets li .name", (els) => els.map((e) => e.textContent));
const meta = (p) => p.$$eval("#meta div", (els) => Object.fromEntries(els.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent])));
const shot = async (p, name) => {
    if (SHOTS) await p.screenshot({ path: resolve(SHOTS, name + ".png"), fullPage: true });
};
async function paste(p, text) {
    if (await p.isHidden("#paste")) await p.click("#btn-paste");
    await p.fill("#paste-text", text);
    await p.click("#paste button[type=submit]");
    await p.waitForSelector("#result:not([hidden])");
}

try {
    // ---- the link a phone camera opens
    let p = await page();
    await p.goto(server.url + "#" + demo.slice(PREFIX.length));
    await p.waitForSelector("body[data-ready='1']");
    expect(JSON.stringify(await names(p)) === JSON.stringify(DEMO), `link: list is ${JSON.stringify(await names(p))}`);
    const m = await meta(p);
    expect(m["Format version"] === "1" && m["Mapping version"] === String(current) && m["Assets found"] === "4" && m["Unknown assets"] === "0" && m.Checksum === "OK", `link: metadata ${JSON.stringify(m)}`);
    expect((await p.textContent("#result-pill")) === "Decoded", "link: status pill is not Decoded");
    const ids = await p.$$eval("#assets .tag.id", (els) => els.map((e) => e.textContent));
    expect(JSON.stringify(ids) === JSON.stringify(DEMO.map((n) => idOf.get(n))), `link: ID chips ${JSON.stringify(ids)}`);
    await p.click("#debug summary");
    expect((await p.textContent("#debug-body pre")) === demo.slice(PREFIX.length), "developer view: raw payload not shown exactly");
    await shot(p, "1-link");

    // JSON / CSV downloads
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-export=json]")]);
    const jf = resolve(TMP, "out.json");
    await dl.saveAs(jf);
    const json = JSON.parse(require("node:fs").readFileSync(jf, "utf8"));
    expect(JSON.stringify(json.items.map((i) => i.enum)) === JSON.stringify(DEMO), "JSON download: wrong items");
    const [dl2] = await Promise.all([p.waitForEvent("download"), p.click("[data-export=csv]")]);
    const cf = resolve(TMP, "out.csv");
    await dl2.saveAs(cf);
    expect(require("node:fs").readFileSync(cf, "utf8").split("\n").length === DEMO.length + 2, "CSV download: wrong row count");

    // lookup
    await p.click("#lookup summary");
    await p.fill("#lookup-q", idOf.get(DEMO[0]));
    expect((await p.$$eval("#lookup-list .name", (els) => els.map((e) => e.textContent)))[0] === DEMO[0], "lookup: ID search does not find the asset");
    await p.context().close();

    // ---- an image of the code the mod draws (the library encoder's matrix; test-qr.mjs proves they match)
    const png = resolve(TMP, "demo-qr.png");
    writeFileSync(png, pngOf(QREncoder.encode(demo, "L")));
    if (SHOTS) writeFileSync(resolve(SHOTS, "demo-qr.png"), pngOf(QREncoder.encode(demo, "L")));
    p = await page();
    await p.goto(server.url);
    await p.waitForSelector("body[data-ready='1']");
    await p.setInputFiles("#file", png);
    await p.waitForSelector("#result:not([hidden])", { timeout: 15000 });
    expect(JSON.stringify(await names(p)) === JSON.stringify(DEMO), `upload: list is ${JSON.stringify(await names(p))}`);
    expect(p.url().endsWith("#" + demo.slice(PREFIX.length)), "upload: the address bar does not carry the payload for sharing");

    // ---- unknown ID: kept and flagged
    const withUnknown = packPayloads([idOf.get(DEMO[0]), "ZZZ", idOf.get(DEMO[1])], { mapping: current })[0];
    await paste(p, withUnknown);
    const un = await names(p);
    expect(un.length === 3 && un[1] === "⚠ Unknown Asset ID: ZZZ", `unknown: list is ${JSON.stringify(un)}`);
    expect((await meta(p))["Unknown assets"] === "1", "unknown: metadata does not count it");
    expect((await p.textContent("#result-pill")) === "Decoded with warnings", "unknown: pill is not a warning");
    await shot(p, "2-unknown");

    // ---- corrupt and foreign codes
    const corrupt = demo.slice(PREFIX.length).replace(".0XG", ".0XH");
    await paste(p, corrupt);
    expect((await p.textContent("#result-pill")) === "Could not decode" && /Checksum mismatch/.test(await p.textContent("#messages")), "corrupt: no checksum error shown");
    await shot(p, "3-corrupt");
    await paste(p, "https://example.com/menu");
    expect(/not an SFX\/VFX Showcase code/.test(await p.textContent("#messages")), "foreign: not refused");
    const h = "SV1.7.1-1." + hash("000") + ".000";
    await paste(p, h + "." + hash(h));
    expect(/Mapping 7 is not published/.test(await p.textContent("#messages")), "unsupported mapping: no message");

    // ---- legacy code with full names
    await paste(p, legacyPayloads(DEMO.slice(0, 2))[0]);
    expect(JSON.stringify(await names(p)) === JSON.stringify(DEMO.slice(0, 2)) && (await meta(p))["Format version"] === "Legacy (full names)", "legacy: not decoded");
    await p.context().close();

    // ---- a list in two codes, scanned one after the other
    const many = Object.entries(map.ids).filter(([, e]) => e.k === "sfx").slice(0, 300);
    const parts = packPayloads(many.map(([id]) => id), { mapping: current });
    expect(parts.length === 2, `split: expected 2 codes, got ${parts.length}`);
    p = await page(390);
    await p.goto(server.url + "#" + parts[0]);
    await p.waitForSelector("body[data-ready='1']");
    expect(/Still needed: part 2/.test(await p.textContent("#parts-text")), "split: part 1 does not ask for part 2");
    await p.goto(server.url + "#" + parts[1]);
    await p.waitForFunction(() => /All 2 parts/.test(document.getElementById("parts-text").textContent));
    const all = await names(p);
    expect(all.length === 300 && all[0] === many[0][1].n && all[299] === many[299][1].n, `split: joined list has ${all.length} items`);
    await p.click("#btn-parts-view");
    expect((await names(p)).length < 300, "split: 'Show only part' does not narrow the list");
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow <= 0, `phone width: the page scrolls sideways by ${overflow}px`);
    await p.goto(server.url + "#" + demo.slice(PREFIX.length));
    await p.waitForSelector("#result:not([hidden])");
    await shot(p, "4-phone");
    await p.context().close();

    expect(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
} finally {
    await browser.close();
    server.close();
}

if (problems.length > 0) {
    console.error("  SITE BUGS:");
    for (const x of problems) console.error("    - " + x);
    process.exit(1);
}
console.log("  site    : link, image upload, paste, unknown/corrupt/foreign/legacy codes, two-part lists, JSON/CSV, lookup and phone width all work in Chromium");
