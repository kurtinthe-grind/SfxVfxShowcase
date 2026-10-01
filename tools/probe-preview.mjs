// Headless harness: runs preview/src/sandbox.js against a stubbed DOM and dumps
// the element tree with resolved pixel geometry, so layout bugs show up without
// a browser. Usage: node tools/probe-preview.mjs [view]

import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SCENE = JSON.parse(readFileSync(resolve(ROOT, "src", "scene.json"), "utf8"));
const view = process.argv[2] ?? "sfx";

const created = [];

function makeEl(tag) {
    const el = {
        tagName: tag,
        className: "",
        style: {},
        children: [],
        textContent: "",
        title: "",
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        parentNode: null,
        appendChild(c) {
            c.parentNode = el;
            el.children.push(c);
            return c;
        },
        remove() {},
        setAttribute() {},
        addEventListener() {},
        querySelector() {
            return null;
        },
    };
    return el;
}

const viewport = makeEl("div");
viewport.id = "viewport";

globalThis.document = {
    createElement: (t) => makeEl(t),
    getElementById: (id) => (id === "viewport" ? viewport : makeEl("div")),
    addEventListener() {},
    body: makeEl("body"),
};
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { search: "?view=" + view };
globalThis.EventSource = class {
    constructor() {}
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.URL = URL;

process.env.PROBE_VIEW = view;

const mod = await import(pathToFileURL(resolve(ROOT, "preview", "src", "sandbox.js")).href);

// The sandbox builds into the viewport via the renderer; walk the stubbed tree.
function collect(el, depth, out) {
    for (const c of el.children) {
        const s = c.style;
        const pos = s.position === "absolute" ? `${s.left},${s.top}` : "-";
        const size = `${s.width} x ${s.height}`;
        out.push({
            depth,
            cls: c.className,
            pos,
            size,
            text: (c.textContent ?? "").slice(0, 34),
            fontSize: s.fontSize ?? "(unset)",
            alpha: s.backgroundColor ?? "",
        });
        collect(c, depth + 1, out);
    }
}

const rows = [];
collect(viewport, 0, rows);

console.log(`view=${view}  elements=${rows.length}\n`);

// Region check: count elements whose top-left falls inside the list band.
const inBand = (y0, y1, x0, x1) =>
    rows.filter((r) => {
        const m = /^(\d+)px,(\d+)px$/.exec(r.pos);
        if (!m) return false;
        const x = +m[1];
        const y = +m[2];
        return x >= x0 && x < x1 && y >= y0 && y < y1;
    });

const g = SCENE.grid;
const band = inBand(g.originY, g.originY + g.rows * g.rowH, g.originX, g.originX + g.rowW);
console.log(`row band (${g.originX},${g.originY}) ${g.rowW}x${g.rows * g.rowH}: ${band.length} elements`);

const firstName = rows.find((r) => r.text && r.cls === "bf6-text" && /^(\d+)px,(\d+)px$/.test(r.pos) && +RegExp.$1 >= g.originX && +RegExp.$1 < g.originX + 300 && +RegExp.$2 >= g.originY && +RegExp.$2 < g.originY + g.rowH);
console.log(`first row name: ${firstName ? JSON.stringify(firstName.text) : "(none)"}`);

const railBand = inBand(SCENE.rail.rowsY, SCENE.rail.rowsY + SCENE.rail.visibleRows * SCENE.rail.rowH, SCENE.rail.x, SCENE.rail.x + SCENE.rail.w);
console.log(`rail band: ${railBand.length} elements`);


const withText = rows.filter((r) => r.text && r.text.length);
const DUMP = process.env.DUMP === "1";
if (DUMP) {
    console.log(`--- all ${withText.length} text elements ---`);
    for (const r of withText) {
        console.log(`  ${r.pos.padEnd(16)} ${r.size.padEnd(16)} fs=${String(r.fontSize).padEnd(7)} ${JSON.stringify(r.text)}`);
    }
} else {
    console.log("\n--- text elements in the row band ---");
    for (const r of band.filter((r) => r.text).slice(0, 24)) {
        console.log(`  ${r.pos.padEnd(16)} ${r.size.padEnd(16)} fs=${String(r.fontSize).padEnd(7)} ${JSON.stringify(r.text)}`);
    }
}

const zeroSize = rows.filter((r) => r.size.startsWith("0 "));
console.log(`\nzero-size elements: ${zeroSize.length}`);
console.log(`total elements: ${rows.length}`);

void mod;

