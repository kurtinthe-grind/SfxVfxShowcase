// Proves handle() in index.ts covers every action ui.ts can emit.
//
// This is the one part of the codebase that cannot be typechecked. ui.ts produces a
// string; handle() compares a string; nothing connects the two, so a disagreement
// produces a dead button with no error and often no visual cue. Three such breaks
// existed at the start of the utils migration and all three survived source review:
//
//   chips   ui.ts emitted "chipfd3"   handle() tested action[0] === "f"
//   bottom  ui.ts emitted "spc"       handle() tested "kbdspc"
//   rail    ui.ts emitted "rail0"     handle() parsed action.slice(1) as "c0"
//
// In the first case the unclaimed action then fell into the rail branch, parseInt
// returned NaN, and the click vanished.
//
// The contract has two halves, and both are checked here:
//
//   1. Scene actions. gen-scene.mjs emits NODE_ACTIONS from the same data the node
//      ids come from, so this list cannot drift from the scene.
//
//   2. Dynamic families. These are built in ui.ts from slot indices and are not
//      scene data: key_<char>, pfx_<token>, rail<row>, and r<row>_<tag>.
//
// The complement is checked too: an action handle() tests that nothing can emit is
// dead code, and the usual cause is a rename on one side only.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const idx = readFileSync(resolve(ROOT, "src", "index.ts"), "utf8").replace(/\r\n/g, "\n");
const sceneGen = readFileSync(resolve(ROOT, "src", "scene.gen.ts"), "utf8").replace(/\r\n/g, "\n");
const ui = readFileSync(resolve(ROOT, "src", "ui.ts"), "utf8").replace(/\r\n/g, "\n");
const problems = [];

/**
 * The action literals passed at ensureWidget() call sites.
 *
 * The action is the third argument, after the PlayerUi and the widget spec. The
 * spec contains nested objects and calls, so the arguments have to be split on
 * top-level commas rather than with a regex.
 */
function inlineActions(body) {
    const CLICKABLE = new Set(["textbutton", "button"]);
    const out = [];
    for (const at of body.matchAll(/ensureWidget\(/g)) {
        const args = topLevelArgs(body, at.index + "ensureWidget(".length);
        // Fewer than three arguments means this was a bare mention in a comment
        // ("ensureWidget() allocates once"), not a call.
        if (args === null || args.length < 3) continue;
        // The third argument doubles as a handle key for every widget kind, so the
        // spec's own k decides. kbRoot and kbHint are UIText labels keyed by the
        // same parameter; no click can ever produce them.
        const kind = args[1].match(/\bk:\s*"([A-Za-z]+)"/);
        if (kind === null || !CLICKABLE.has(kind[1])) continue;
        const lit = args[2].trim().match(/^"([A-Za-z_][A-Za-z0-9_]*)"$/);
        // A non-literal is a composed action (a slot name, or a resolver closure),
        // which the dynamic-family checks cover instead.
        if (lit !== null) out.push(lit[1]);
    }
    return out;
}

/** Splits a call's argument list on top-level commas, tracking (), {} and []. */
function topLevelArgs(body, from) {
    const args = [];
    let depth = 0;
    let start = from;
    for (let i = from; i < body.length; i++) {
        const c = body[i];
        if (c === "(" || c === "{" || c === "[") depth++;
        else if (c === ")" || c === "}" || c === "]") {
            if (depth === 0) {
                args.push(body.slice(start, i));
                return args;
            }
            depth--;
        } else if (c === "," && depth === 0) {
            args.push(body.slice(start, i));
            start = i + 1;
        }
    }
    return null;
}

// chipAction() maps a filter chip to its action code; those are the only actions
// produced by a return statement rather than at a call site.
function chipActions(body) {
    const fn = body.slice(body.indexOf("function chipAction("));
    const end = fn.indexOf("\n}\n");
    return [...fn.slice(0, end < 0 ? undefined : end).matchAll(/return "([a-z]{2,3})"/g)].map((m) => m[1]);
}

// ---- the emitted scene actions, read from the generated constant
const m = sceneGen.match(/export const NODE_ACTIONS: readonly string\[\] = \[([\s\S]*?)\];/);
if (m === null) {
    problems.push("scene.gen.ts has no NODE_ACTIONS; run gen-scene.mjs (the action contract is generated with the scene)");
} else {
    const emitted = [
        ...new Set([
            ...m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")),
            ...inlineActions(ui),
            ...chipActions(ui),
        ]),
    ].filter((s) => s !== "");

    // ---- what handle() actually tests
    const exact = new Set();
    for (const r of idx.matchAll(/action === "([^"]+)"/g)) exact.add(r[1]);
    const prefixes = [];
    for (const r of idx.matchAll(/action\.slice\(0, (\d+)\) === "([^"]+)"/g)) {
        prefixes.push({ len: Number(r[1]), text: r[2] });
    }
    const firstChars = new Set();
    for (const r of idx.matchAll(/action(?:\.charAt\(0\)|\[0\]) === "([^"]+)"/g)) firstChars.add(r[1]);

    // A row action is r<idx>_<tag>; the row branch parses it with indexOf("_").
    const handlesRowFamily = /action\.charAt\(0\) === "r"/.test(idx) && /indexOf\("_"\)/.test(idx);

    const isHandled = (a) => {
        if (exact.has(a)) return true;
        for (const p of prefixes) if (a.slice(0, p.len) === p.text) return true;
        for (const c of firstChars) if (a.charAt(0) === c) return true;
        if (handlesRowFamily && a.charAt(0) === "r" && a.indexOf("_") >= 2) return true;
        return false;
    };

    const unhandled = emitted.filter((a) => !isHandled(a));
    if (unhandled.length > 0) {
        problems.push(
            `handle() does not handle ${unhandled.length} scene action(s): ${unhandled.join(", ")} -- ` +
                "those buttons will be dead"
        );
    }

    // ---- the reverse: nothing tested that nothing emits
    const dynamic = ["key_", "pfx_", "rail", "r"];
    const dead = [...exact].filter((a) => {
        if (dynamic.includes(a)) return false;
        if (emitted.includes(a)) return false;
        // The c<row> fallback exists only for stray legacy names, by design.
        if (a === "c") return false;
        return true;
    });
    if (dead.length > 0) {
        problems.push(
            `handle() tests ${dead.length} action(s) nothing can emit: ${dead.join(", ")} -- ` +
                "usually a rename that only landed on one side"
        );
    }
}

// ---- the dynamic families, by name. These are built in ui.ts, not the scene.
for (const [name, probe] of [
    ["key_", /action\.slice\(0, 4\) === "key_"/],
    ["pfx_", /action\.slice\(0, 4\) === "pfx_"/],
    ["rail<row>", /action\.slice\(0, 4\) === "rail"/],
    ["r<row>_<tag>", /action\.charAt\(0\) === "r"/],
]) {
    if (!probe.test(idx)) problems.push(`handle() no longer recognises the ${name} family (${probe})`);
}

// The same families must still be built on the emit side. Without this, renaming
// ui.ts's rail from "rail" + row to "c" + row is invisible to the gate above: the
// composed action is not a literal, so it never enters the emitted set, and the
// only thing that notices is the player clicking a dead group. This is asserted on
// both sides of the same name, which is what makes the family a contract rather
// than a coincidence.
for (const [name, emit] of [
    ["key_", /ui\.keyAct\[[^\]]+\] = "key_" \+ /],
    ["pfx_", /ui\.pfxAct\[[^\]]+\] = "pfx_" \+ /],
    // Anchored to the composition, not the bare prefix: the handle key is
    // "railBtn" + slot, so a probe matching that would pass even if the action
    // were never built. The emitted action is the group index itself, computed
    // into a local so the handler needs no paging arithmetic to agree with it.
    ["rail<group>", /const action = "rail" \+ gi;/],
    // The row prefix is handed to buildNodes() as an argument and the tag is
    // appended inside, so the emit side is the prefix construction, not a
    // single concatenation.
    ["r<row>_<tag>", /"r" \+ i \+ "_"/],
]) {
    if (!emit.test(ui)) problems.push(`ui.ts no longer builds the ${name} family (${emit})`);
}

// The ALL row is the absence of a filter, not an action. It must be a text node
// of its own, never a button, and it must not share a key with the group rows:
// when one slot served both, the handle created on a later page could not change
// kind and ALL stayed clickable.
if (!/\{ \.\.\.RAIL_ROW, k: "text" \}/.test(ui)) {
    problems.push('ui.ts no longer builds the rail ALL row as text ({ ...RAIL_ROW, k: "text" })');
}
if (!/"railAll"/.test(ui)) {
    problems.push('ui.ts no longer gives the rail ALL row its own "railAll" handle key');
}
if (/ensureWidget\(ui, node, "rail" \+ slot,/.test(ui)) {
    problems.push("ui.ts still shares one rail handle key between the ALL row and the group rows");
}

// ---- the runtime backstop, and the flag that the gate above is not the only defence
if (!/UNHANDLED ACTION/.test(idx)) {
    problems.push("index.ts does not log an unhandled action, so a misroute would be silent in game again");
}

if (problems.length > 0) {
    console.error("  ACTION CONTRACT BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log("  actions : every scene action and dynamic family is handled by handle()");
