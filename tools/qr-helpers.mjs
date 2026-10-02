// Shared by the QR tests: the library encoder, the website's maps, reading a drawn
// code back out of a replay, and decoding it the way a phone camera would (jsQR).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { ROOT } from "./ui-replay.mjs";

const require = createRequire(resolve(ROOT, "package.json"));
const ts = require("typescript");
export const jsQR = require("jsqr");

export const MARGIN = 4;

/** bf6-portal-utils' QREncoder, run in Node: the reference for what a correct code looks like. */
export function loadEncoder() {
    const src = readFileSync(resolve(ROOT, "..", "main_resources", "bf6-portal-utils-master", "ui", "components", "qr-code", "encoder.ts"), "utf8");
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const m = { exports: {} };
    new Function("module", "exports", "require", js)(m, m.exports, require);
    return m.exports.QREncoder;
}

/** The website's published maps: { maps: {id: map}, current, index }. */
export function loadMaps() {
    const dir = resolve(ROOT, "site", "data");
    const index = JSON.parse(readFileSync(resolve(dir, "maps.json"), "utf8"));
    const maps = {};
    for (const [id, file] of Object.entries(index.mappings)) maps[id] = JSON.parse(readFileSync(resolve(dir, file), "utf8"));
    return { maps, current: index.current, index };
}

/**
 * Rebuilds the drawn QR from AddUIContainer calls made since `from`: the
 * container with the most children holds the module rectangles. Returns the
 * module grid (n x n, quiet zone stripped), the container's size, the code's
 * widget names and its rectangle count.
 */
export function drawnGrid(calls, from, n) {
    const made = calls.slice(from).filter((c) => c.name === "AddUIContainer");
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

/** Module grid -> RGBA pixels with a white quiet zone, `scale` px per module. */
export function rgbaOf(grid, scale = 6) {
    const n = grid.length;
    const side = (n + 2 * MARGIN) * scale;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
            if (!grid[r][c]) continue;
            for (let y = 0; y < scale; y++)
                for (let x = 0; x < scale; x++) {
                    const i = (((r + MARGIN) * scale + y) * side + (c + MARGIN) * scale + x) * 4;
                    data[i] = data[i + 1] = data[i + 2] = 0;
                }
        }
    return { data, width: side, height: side };
}

/** Reads a module grid the way a camera app would; undefined if jsQR finds no code. */
export function scanGrid(grid) {
    const img = rgbaOf(grid);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data;
}

/** Module grid -> PNG file bytes (8-bit greyscale). */
export function pngOf(grid, scale = 8) {
    const img = rgbaOf(grid, scale);
    const raw = Buffer.alloc((img.width + 1) * img.height);
    for (let y = 0; y < img.height; y++) {
        raw[y * (img.width + 1)] = 0;
        for (let x = 0; x < img.width; x++) raw[y * (img.width + 1) + 1 + x] = img.data[(y * img.width + x) * 4];
    }
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const c = Buffer.alloc(4);
        c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(img.width, 0);
    ihdr.writeUInt32BE(img.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 0; // greyscale
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** The pre-mapping QR texts (full names under a header), for size comparisons. */
export function legacyPayloads(lines, qrBytes = 718) {
    if (lines.length === 0) return [];
    const header = (p, o) => "SFX/VFX SHOWCASE FAVOURITES " + p + "/" + o;
    const room = qrBytes - (header(99, 99).length + 1);
    const parts = [];
    let cur = [];
    let used = 0;
    for (const raw of lines) {
        const line = raw.length > room ? raw.slice(0, room) : raw;
        const cost = line.length + (cur.length > 0 ? 1 : 0);
        if (cur.length > 0 && used + cost > room) {
            parts.push(cur);
            cur = [];
            used = 0;
        }
        used += line.length + (cur.length > 0 ? 1 : 0);
        cur.push(line);
    }
    parts.push(cur);
    return parts.map((p, i) => header(i + 1, parts.length) + "\n" + p.join("\n"));
}

/** QR version (1..40) a byte-mode payload needs at ECC L, via the library encoder. */
export function qrSide(QREncoder, text) {
    return QREncoder.encode(text, "L")?.length;
}

/** Template lines compare without their per-match number. */
export const unnumbered = (l) => l.replace(/^(MUSIC|RADIO) TEMPLATE \d+/, "$1 TEMPLATE #");
