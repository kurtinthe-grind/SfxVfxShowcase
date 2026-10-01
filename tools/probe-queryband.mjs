// Checks that the simulated keyboard's query readout has room above the key rows.
//
// This is the regression guard for the bug that hid the readout in game: it was
// positioned with absolute scene coordinates while the key rows are placed relative
// to the keyboard container, so the two used different origins and the readout landed
// on the third key row. gen-scene.mjs could not catch that, because the scene data
// was always correct -- the renderer was the thing that was wrong.
//
// So this checks the geometry the fix depends on (readout clears the keys, stays
// inside the box, and the bottom bar still clears the prefix grid) and gen-scene
// keeps asserting the rest.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const scene = JSON.parse(readFileSync("src/scene.json", "utf8"));
const kb = scene.keyboard;
const view = process.argv[2] ?? "search";

const out = execFileSync(process.execPath, ["tools/probe-preview.mjs", view], {
    encoding: "utf8",
    maxBuffer: 1 << 24,
});
for (const l of out.split("\n")) {
    if (/view=|total elements|zero-size/.test(l)) console.log("  " + l.trim());
}

const boxBottom = kb.y + kb.h;
const queryBottom = kb.queryY + kb.queryH;
const pgBottom = kb.prefixGrid.rowY[kb.prefixGrid.rowY.length - 1] + kb.prefixGrid.h;
const problems = [];

const gap = kb.rowY[0] - queryBottom;
if (gap < 12) problems.push(`only ${gap}px between the readout (ends ${queryBottom}) and the first key row (${kb.rowY[0]}); it will read as part of the keys`);
if (kb.queryY < kb.y) problems.push(`the readout starts at ${kb.queryY}, above the keyboard box top ${kb.y}`);
if (queryBottom > boxBottom) problems.push(`the readout ends at ${queryBottom}, below the keyboard box bottom ${boxBottom}`);
if (pgBottom > kb.bottomY) problems.push(`the prefix grid ends at ${pgBottom}, colliding with the bottom bar at ${kb.bottomY}`);
if (kb.bottomY + kb.bottomH > boxBottom) problems.push(`the bottom bar ends at ${kb.bottomY + kb.bottomH}, below the keyboard box bottom ${boxBottom}`);

console.log(`\n  keyboard box  : y=${kb.y}..${boxBottom}  x=${kb.x}..${kb.x + kb.w}`);
console.log(`  readout       : y=${kb.queryY}..${queryBottom}`);
console.log(`  first key row : y=${kb.rowY[0]}`);
console.log(`  prefix grid   : y=${kb.prefixGrid.rowY[0]}..${pgBottom}`);
console.log(`  bottom bar    : y=${kb.bottomY}..${kb.bottomY + kb.bottomH}`);
console.log(`  clear space between the readout and the first key row: ${gap}px`);

if (problems.length > 0) {
    console.error("  KEYBOARD LAYOUT BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log("  keyboard OK: the readout sits above the keys, inside the box, clear of the bottom bar");
