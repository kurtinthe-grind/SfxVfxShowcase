// Emits src/scene.gen.ts from src/scene.json.
//
// Why this exists: bf6-portal-bundler inlines an imported .json as a bare
// `{ ... }` block, which is not valid TypeScript and fails to parse. The Portal
// therefore cannot import JSON. This turns the same data into a real TS module so
// the mod and the browser preview stay on one source of truth.
//
// It also validates the layout: every screen/row/rail node must fit inside its
// box, and the list must fit the canvas. A hand-edited coordinate that overflows
// fails the build instead of shipping off-screen.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(ROOT, "src", "scene.json");
const OUT = resolve(ROOT, "src", "scene.gen.ts");

const scene = JSON.parse(readFileSync(SRC, "utf8"));

// ------------------------------------------------------------- bounds checking

const problems = [];

function checkBounds(nodes, boxW, boxH, label) {
    for (const n of nodes) {
        if (n.k === "repeat") {
            const tpl = n.template;
            if (!tpl) continue;
            const count = n.count ?? 0;
            const cols = n.cols ?? 0;
            const gap = n.gap ?? 0;
            const gapX = n.gapX ?? gap;
            const gapY = n.gapY ?? gap;
            const tw = tpl.w ?? 0;
            const th = tpl.h ?? 0;
            const last = Math.max(0, count - 1);
            const lx = cols > 0 ? (last % cols) * (tw + gapX) : last * (tw + gap);
            const ly = cols > 0 ? Math.floor(last / cols) * (th + gapY) : 0;
            const right = n.x + tpl.x + lx + tw;
            const bottom = n.y + tpl.y + ly + th;
            if (right > boxW) problems.push(`${label}: repeat "${n.id ?? "?"}" right ${right.toFixed(1)} > ${boxW}`);
            if (bottom > boxH) problems.push(`${label}: repeat "${n.id ?? "?"}" bottom ${bottom.toFixed(1)} > ${boxH}`);
            continue;
        }
        const w = n.w ?? 0;
        const h = n.h ?? 0;
        if (n.x + w > boxW) problems.push(`${label}: node "${n.id ?? n.k}" right ${(n.x + w).toFixed(1)} > ${boxW}`);
        if (n.y + h > boxH) problems.push(`${label}: node "${n.id ?? n.k}" bottom ${(n.y + h).toFixed(1)} > ${boxH}`);
        if (n.x < 0) problems.push(`${label}: node "${n.id ?? n.k}" x ${n.x} < 0`);
        if (n.y < 0) problems.push(`${label}: node "${n.id ?? n.k}" y ${n.y} < 0`);
    }
}

const CW = scene.canvas.w;
const CH = scene.canvas.h;

checkBounds(scene.screen, CW, CH, "screen");
checkBounds(scene.row, scene.grid.rowW, scene.grid.rowH, "row");
checkBounds([scene.railRow], scene.rail.rowW, scene.rail.rowH, "railRow");

// The list stack must fit between listHead and pager.
const g = scene.grid;
const listBottom = g.originY + g.rows * g.rowH;
if (listBottom > scene.pager.y) {
    problems.push(`list: bottom ${listBottom} overlaps pager at y ${scene.pager.y} (${g.rows} rows x ${g.rowH})`);
}
if (g.originX + g.rowW > CW) problems.push(`list: right ${g.originX + g.rowW} > ${CW}`);
if (scene.footer.y + scene.footer.h > CH) problems.push(`footer: bottom ${scene.footer.y + scene.footer.h} > ${CH}`);

// Rail rows must not run past the rail panel.
const railFit = Math.floor((scene.rail.h - (scene.rail.rowsY - scene.rail.y)) / scene.rail.rowH);
if (scene.rail.visibleRows > railFit) {
    problems.push(`rail: visibleRows ${scene.rail.visibleRows} > ${railFit} that fit in the ${scene.rail.h}px panel`);
}

// Column alignment: every label in the list header must sit at the same x as the
// row column it describes, otherwise the header drifts from its column. This is
// the check that would have caught NAME sitting 48px left of the name text.
{
    const rowXs = scene.row.filter((n) => n.k !== "container" || n.id !== undefined).map((n) => g.originX + n.x);
    const headLabels = scene.screen.filter(
        (n) =>
            n.k === "text" &&
            n.y === scene.listHead.y &&
            n.h === scene.listHead.h &&
            n.x >= scene.listHead.x
    );
    if (headLabels.length === 0) problems.push("listHead: no column labels found to align");
    for (const h of headLabels) {
        if (!rowXs.some((rx) => Math.abs(rx - h.x) <= 1)) {
            problems.push(
                `listHead: label "${h.text ?? "?"}" at x=${h.x} does not line up with any row column ` +
                    `(${rowXs.join(", ")})`
            );
        }
    }
    console.log(`  column check: ${headLabels.length} header labels aligned to ${rowXs.length} row columns`);
}

// Header overlap: every node in the header band must be disjoint from every other.
// The armed read-out and the FAVOURITES tab both wanted the same strip -- the
// armed text was right-aligned into a column that began over the tab -- and the
// only thing that noticed was a screenshot. Buttons and text are both included,
// because a label under a tab is invisible and a tab under a label is unclickable.
//
// The one exception is a pair that takes turns in the same spot: on FAVOURITES
// the armed read-out gives way to QR CODE. Their groups' visibility fields are
// opposites (armedOn / favHead in chromeFields), so they are never shown together.
const SAME_SPOT = [["armed", "btnQr"]];
{
    const band = [scene.panel.y, scene.rail.y];
    const nodes = scene.screen
        .filter((n) => n.id !== undefined && n.y >= band[0] && n.y + n.h <= band[1])
        .sort((a, b) => a.x - b.x);
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i];
            const b = nodes[j];
            const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            const alternates = SAME_SPOT.some((p) => p.includes(a.id) && p.includes(b.id));
            if (overlapX > 0 && overlapY > 0 && !alternates) {
                problems.push(
                    `header: "${a.id}" and "${b.id}" overlap by ${overlapX}x${overlapY}px ` +
                        `(a ${a.x},${a.y} ${a.w}x${a.h}, b ${b.x},${b.y} ${b.w}x${b.h})`
                );
            }
        }
    }
    console.log(`  header check: ${nodes.length} nodes in ${band[0]}..${band[1]}, no overlap`);
}

// Centring: the panel must be exactly centred on the canvas.
{
    const p = scene.panel;
    if (!p) {
        problems.push("panel: scene.json must declare panel {x,y,w,h}");
    } else {
        const wantX = (scene.canvas.w - p.w) / 2;
        const wantY = (scene.canvas.h - p.h) / 2;
        if (p.x !== wantX || p.y !== wantY) {
            problems.push(
                `panel: not centred. x/y should be ${wantX}/${wantY} for a ${p.w}x${p.h} panel on ` +
                    `${scene.canvas.w}x${scene.canvas.h}, got ${p.x}/${p.y}`
            );
        }
        // Every band inside the panel must sit within it, so nothing can end up
        // floating on the world outside the panel background.
        const bands = [
            ["header", scene.header],
            ["rail", { x: scene.rail.x, y: scene.rail.y, w: scene.rail.w, h: scene.rail.h }],
            ["listHead", scene.listHead],
            ["pager", scene.pager],
            ["footer", scene.footer],
            ["list", { x: scene.grid.originX, y: scene.grid.originY, w: scene.grid.rowW, h: scene.grid.rows * scene.grid.rowH }],
        ];
        for (const [name, b] of bands) {
            if (b.x < p.x || b.y < p.y || b.x + b.w > p.x + p.w || b.y + b.h > p.y + p.h) {
                problems.push(
                    `panel: ${name} (${b.x},${b.y} ${b.w}x${b.h}) escapes the panel ` +
                        `(${p.x},${p.y} ${p.w}x${p.h})`
                );
            }
        }
        // The simulated keyboard must also live inside the panel, and every key
        // row must fit the overlay width.
        const kb = scene.keyboard;
        if (!kb) {
            problems.push("keyboard: scene.json must declare a keyboard section");
        } else {
            if (kb.x < p.x || kb.y < p.y || kb.x + kb.w > p.x + p.w || kb.y + kb.h > p.y + p.h) {
                problems.push(`keyboard: overlay escapes the panel`);
            }
            for (let r = 0; r < kb.rows.length; r++) {
                const chars = kb.rows[r];
                const rowW = chars.length * kb.keyW + (chars.length - 1) * kb.gap;
                if (kb.x0 + rowW > kb.x + kb.w) {
                    problems.push(`keyboard: row ${r} ("${chars}") ends at ${kb.x0 + rowW} > ${kb.x + kb.w}`);
                }
                if (kb.rowY[r] + kb.keyH > kb.y + kb.h) {
                    problems.push(`keyboard: row ${r} bottom ${kb.rowY[r] + kb.keyH} > ${kb.y + kb.h}`);
                }
            }
            const bottomW = kb.bottom.reduce((a, b) => a + b.w, 0) + (kb.bottom.length - 1) * kb.gap;
            if (kb.x0 + bottomW > kb.x + kb.w) {
                problems.push(`keyboard: bottom row ends at ${kb.x0 + bottomW} > ${kb.x + kb.w}`);
            }
            if (kb.bottomY + kb.bottomH > kb.y + kb.h) {
                problems.push(`keyboard: bottom row bottom ${kb.bottomY + kb.bottomH} > ${kb.y + kb.h}`);
            }
            // The query readout has to read as an input, not as another key row, so it needs
// clear space above the first key. 12px is the floor; the current layout gives 32.
const queryBottom = kb.queryY + kb.queryH;
if (queryBottom + 12 > kb.rowY[0]) {
    problems.push(
        `keyboard: only ${kb.rowY[0] - queryBottom}px between the query readout (ends ${queryBottom}) and the first key row (${kb.rowY[0]})`
    );
}

const pg = kb.prefixGrid;
            if (!pg) {
                problems.push("keyboard: must declare a prefixGrid section");
            } else {
                if (pg.cols * pg.w + (pg.cols - 1) * pg.gap > kb.w) {
                    problems.push(`keyboard: prefix grid ${pg.cols * pg.w + (pg.cols - 1) * pg.gap} > overlay ${kb.w}`);
                }
                const pgLast = pg.rowY[pg.rowY.length - 1] + pg.h;
                if (pg.rowY[0] < kb.y + kb.h && pgLast > kb.bottomY) {
                    problems.push(`keyboard: prefix grid bottom ${pgLast} overlaps bottom row at ${kb.bottomY}`);
                }
                if (pg.rows * pg.cols < pg.max) {
                    problems.push(`keyboard: prefixGrid capacity ${pg.rows * pg.cols} < max ${pg.max}`);
                }
            }

            if (problems.length === 0) {
                console.log(
                    `  prefix grid OK: ${pg.cols}x${pg.rows} = ${pg.rows * pg.cols} slots, ` +
                        `w=${pg.w} ends ${pg.x0 + pg.cols * pg.w + (pg.cols - 1) * pg.gap}`
                );
                console.log(
                    `  keyboard OK: ${kb.rows.reduce((a, r) => a + r.length, 0) + kb.bottom.length} keys, ` +
                        `fits ${kb.w}x${kb.h} at (${kb.x},${kb.y})`
                );
            }
        }

        // Filter chips must fit between the list edge and the search button.
        const fb = scene.filterBarSpec;
        const chipCount = Math.max(fb.sfx.length, fb.vfx.length);
        const chipsW = chipCount * fb.chipW + (chipCount - 1) * fb.gap;
        if (fb.chipX + chipsW > fb.searchX) {
            problems.push(`filters: chips end at ${fb.chipX + chipsW} > search button at ${fb.searchX}`);
        }
        if (fb.searchX + fb.searchW > scene.listHead.x + scene.listHead.w) {
            problems.push(`filters: search button escapes the list area`);
        }

        if (problems.length === 0) console.log(`  panel centred: ${p.w}x${p.h} at (${p.x},${p.y})`);
    }
}

// scene.row is a template, not a source of top-level actions: ui.ts composes each
// row button's action with its index ("r0_act"), so its ids are never dispatched
// bare. The two ids it holds define the r<n>_<tag> family, which check-actions.mjs
// asserts separately -- so verify the family has not been renamed underneath it.
// This has to run before the report below, or it would never fail anything.
const rowTemplateIds = (() => {
    const out = [];
    const walk = (nodes) => {
        for (const n of Array.isArray(nodes) ? nodes : []) {
            if (n === null || typeof n !== "object") continue;
            if (n.k === "textbutton" && typeof n.id === "string" && n.id !== "") out.push(n.id);
            if (Array.isArray(n)) walk(n);
            else for (const v of Object.values(n)) if (v !== null && typeof v === "object") walk(v);
        }
    };
    walk(scene.row);
    return out.sort();
})();
if (rowTemplateIds.join(",") !== "fav,play,sel,stop") {
    problems.push(
        `scene.row template ids changed: ${rowTemplateIds.join(",")} (expected fav,play,sel,stop). ui.ts composes these ` +
            "with a row index, and check-actions.mjs asserts the r<n>_<tag> family by name"
    );
}

if (problems.length) {
    console.error("  SCENE LAYOUT ERRORS:");
    for (const p of problems) console.error(`    - ${p}`);
    process.exit(1);
}
console.log(
    `  layout OK: list ${g.rows} rows x ${g.rowH} @ ${g.originX},${g.originY} (bottom ${listBottom}), rail ${scene.rail.visibleRows} rows`
);

// ---------------------------------------------------------------- emit module

const body = `// AUTO-GENERATED by tools/gen-scene.mjs - DO NOT EDIT BY HAND.
// Source: src/scene.json  (edit that file, then run: npm run gen)
//
// The Portal bundler cannot import .json (it inlines it as an invalid bare
// block), so the same data the browser preview renders is emitted here as a
// TypeScript module instead.

export interface SceneNode {
    k: "container" | "text" | "textbutton" | "button" | "repeat" | "group";
    id?: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    count?: number;
    gap?: number;
    gapX?: number;
    gapY?: number;
    cols?: number;
    template?: SceneNode | null;
    parent?: string;
    visible?: boolean;
    fill?: string;
    bg?: string;
    bgAlpha?: number;
    text?: string;
    textSize?: number;
    color?: string;
    textColor?: string;
    textAlpha?: number;
    align?: string;
    wrap?: boolean;
    enabled?: boolean;
    wScale?: string;
    bind?: Record<string, string>;
}

export const PALETTE: Readonly<Record<string, string>> = ${JSON.stringify(scene.palette, null, 4)};

export const GRID = ${JSON.stringify(scene.grid, null, 4)} as const;

export const RAIL = ${JSON.stringify(scene.rail, null, 4)} as const;

export const RAIL_ROW: SceneNode = ${JSON.stringify(scene.railRow, null, 4)};

export const RAIL_PAGER: readonly SceneNode[] = ${JSON.stringify(scene.railPager ?? [], null, 4)};

export const SCREEN: readonly SceneNode[] = ${JSON.stringify(scene.screen, null, 4)};

export const ROW: readonly SceneNode[] = ${JSON.stringify(scene.row, null, 4)};

export const KEYBOARD = ${JSON.stringify(scene.keyboard, null, 4)} as const;

export const FILTERS = ${JSON.stringify(scene.filterBarSpec, null, 4)} as const;

export const CANVAS = ${JSON.stringify(scene.canvas)} as const;

/**
 * Every action a click can produce, from the scene's own nodes.
 *
 * Emitted by the generator so check-actions.mjs can prove that handle() in
 * index.ts covers all of them. A clickable node's id IS its action: ui.ts passes
 * n.id straight through to ensureWidget(), which attaches it to the button.
 */
export const NODE_ACTIONS: readonly string[] = ${JSON.stringify(collectActions(), null, 4)};
`;

/**
 * The action names the scene can produce.
 *
 * A textbutton or button node with an id emits that id as its action. The
 * keyboard's bottom row is the other source: it has no node ids, and its actions
 * come straight from the JSON. The dynamic families (key_, pfx_, rail<n>,
 * r<n>_<tag>) are built in ui.ts from slot indices and are not scene data, so
 * check-actions.mjs asserts those against index.ts separately.
 */
function collectActions() {
    const out = new Set();
    const CLICKABLE = new Set(["textbutton", "button"]);
    const walk = (nodes) => {
        for (const n of Array.isArray(nodes) ? nodes : []) {
            if (n === null || typeof n !== "object") continue;
            if (CLICKABLE.has(n.k) && typeof n.id === "string" && n.id !== "") out.add(n.id);
            if (Array.isArray(n)) walk(n);
            else for (const v of Object.values(n)) if (v !== null && typeof v === "object") walk(v);
        }
    };
    walk(scene.screen);
    walk(scene.railRow === undefined ? [] : [scene.railRow]);
    // The rail's pager is a separate node list, but its buttons are as real as any
    // other scene action -- and ui.ts emits them by id rather than by a literal, so
    // check-actions.mjs cannot find them in the source.
    walk(scene.railPager ?? []);
    for (const b of scene.keyboard?.bottom ?? []) if (typeof b.action === "string") out.add(b.action);
    return [...out].sort();
}

writeFileSync(OUT, body, "utf8");
console.log(`  wrote ${OUT}`);
console.log(`  screen ${scene.screen.length} | row ${scene.row.length} | palette ${Object.keys(scene.palette).length}`);
