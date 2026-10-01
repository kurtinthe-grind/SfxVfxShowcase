// Behaviour test for the group rail on the SOUND and VISUAL tabs.
//
// Replays dist/bundle.ts and clicks rail groups, on the first rail page and
// after GROUPS >, and checks the list then shows exactly that group:
//
//   - every row on the list belongs to the clicked group (its group column
//     shows the same strings key as the rail label);
//   - the rail label's count is the size of that group;
//   - ALL is a button and brings the full list back.
//
// In game on 2026-10-01 a group on rail page 2 showed the group in the same
// slot on page 1 (Panzerfaust showed Airplane), because a button kept the
// action it was created with. Every label was also one group off its count.
//
// It also checks no on-screen name contains a word the game masks with '#'
// (seen in game: "MF" showed as "##", "Smoke" as "#####").

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";

const TEXT_GEN = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
const STRINGS = JSON.parse(readFileSync(resolve(ROOT, "dist", "bundle.strings.json"), "utf8"));
function labelKey(field) {
    const m = new RegExp(`\\b${field}: "(\\w+)"`).exec(TEXT_GEN);
    if (m === null) throw new Error(`text.gen.ts has no label ${field}`);
    return m[1];
}
const GAP2 = labelKey("gap2");
const ALL = labelKey("chipAll");
const problems = [];

// ---- masked words
const MASKED = ["MF", "Smoke"];
for (const [key, text] of Object.entries(STRINGS)) {
    for (const w of MASKED) {
        if (new RegExp(`(^|[^A-Za-z])${w}([^A-Za-z]|$)`).test(text)) problems.push(`strings ${key} "${text}" contains "${w}", which the game shows as #`);
    }
}

// ---- rail behaviour
const s = await replay(readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8"));
const buttons = () => new Set(s.calls.filter((c) => c.name === "AddUIButton").map((c) => c.args[0]));
/** Visible rail rows: [{msg, isButton}], top to bottom. ALL first. */
function rail() {
    const b = buttons();
    return s.visibleTexts()
        .filter((t) => t.msg[0] === GAP2)
        .map((t) => ({ msg: t.msg, isButton: b.has(t.parent + "_b"), parent: t.parent }));
}
/**
 * The group keys shown in the list's group column. The column is found by its x
 * on the unfiltered list (where catalog groups, sxg*, are shown); screen-effect
 * rows use other keys (catGas, catScreen) in the same column.
 */
let groupX = -1;
function findGroupColumn() {
    const xs = s.visibleTexts().filter((t) => t.msg.length === 1 && /^sxg\d+$/.test(t.msg[0]) && t.x > 450).map((t) => t.x);
    groupX = xs.sort((a, b) => xs.filter((x) => x === b).length - xs.filter((x) => x === a).length)[0] ?? -1;
}
function rowGroups() {
    return s.visibleTexts()
        .filter((t) => t.msg.length === 1 && t.x === groupX && t.y > 290 && t.y < 770)
        .map((t) => t.msg[0]);
}
function press(r) {
    s.clickText(GAP2, rail().filter((x) => x.isButton).findIndex((x) => x.parent === r.parent));
}
async function checkGroup(where, r) {
    press(r);
    await s.ticks(40);
    const [, key, count] = r.msg;
    const groups = rowGroups();
    const name = STRINGS[key] ?? key;
    if (groups.length === 0) problems.push(`${where}: clicked ${name} (${count}), the list is empty`);
    const wrong = [...new Set(groups.filter((g) => g !== key))].map((g) => STRINGS[g] ?? g);
    if (wrong.length > 0) problems.push(`${where}: clicked ${name} (${count}), the list shows ${wrong.join(", ")}`);
    if (groups.length !== Math.min(count, 8)) problems.push(`${where}: clicked ${name}, label says ${count}, list shows ${groups.length} rows`);
}

try {
    s.start();
    await s.ticks(5);
    s.deploy();
    await s.ticks(40);
    s.aim();
    await s.ticks(40);
    for (const tab of ["VISUAL", "SOUND"]) {
        s.click(tab);
        await s.ticks(40);
        findGroupColumn();
        if (groupX < 0) problems.push(`${tab}: no group column on the unfiltered list`);
        const page1 = rail();
        if (page1[0]?.msg[1] !== ALL) problems.push(`${tab}: the first rail row is ${JSON.stringify(page1[0]?.msg)}, expected ALL`);
        if (page1.slice(1).some((r) => r.msg[1] === ALL)) problems.push(`${tab}: a group row is labelled ALL`);
        const groups1 = page1.filter((r) => r.isButton && r.msg[1] !== ALL);
        for (const i of [0, 4]) await checkGroup(`${tab} page 1 slot ${i}`, groups1[i]);
        // Rail page 2: the slots are reused for other groups.
        s.click("GROUPS >");
        await s.ticks(40);
        const groups2 = rail().filter((r) => r.isButton && r.msg[1] !== ALL);
        if (groups2.length === 0 || groups2[0].msg[1] === groups1[0].msg[1]) problems.push(`${tab}: GROUPS > did not page the rail`);
        for (const i of [0, 4]) if (groups2[i] !== undefined) await checkGroup(`${tab} page 2 slot ${i}`, groups2[i]);
        // ALL brings the full list back.
        const all = rail().find((r) => r.msg[1] === ALL);
        if (all === undefined || !all.isButton) {
            problems.push(`${tab}: ALL is not a button, so a picked group cannot be cleared`);
        } else {
            press(all);
            await s.ticks(40);
            if (new Set(rowGroups()).size < 2) problems.push(`${tab}: ALL did not bring back the full list`);
        }
    }
    for (const l of s.logs) if (/UNHANDLED ACTION|error|exception/i.test(l)) problems.push("log: " + l);
} finally {
    s.dispose();
}

if (problems.length > 0) {
    console.error("  RAIL BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log("  rail    : every group shows its own rows on every rail page, counts match, ALL clears, no masked words");
