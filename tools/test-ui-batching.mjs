// Regression gate for the 2026-10-01 menu-open crash.
//
// The game client crashes when ~245 UI widgets are created in one tick (the
// script logs "render end" and then the engine dies). The fix spreads widget
// creation over several passes. This gate replays the real dist/bundle.ts and
// fails if:
//
//   1. any single render pass creates more than MAX_PER_PASS engine widgets, in
//      any scenario (deploy, menu open, every tab switch);
//   2. the batched build ends in a different widget state from the same bundle
//      with batching switched off -- batching must change WHEN, never WHAT;
//   3. the unbatched copy does NOT trip check 1. A gate nobody has seen fail is
//      not a gate (same reasoning as test-ascii-gate.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay, createdPerPass, finalState } from "./ui-replay.mjs";

/**
 * Engine widgets per pass. The crashing build made ~245; the fixed one makes up to
 * ~80 (30 elements, a text button being three engine widgets). Set between the two.
 */
const MAX_PER_PASS = 100;

/** Clicked in order once the menu is open; each becomes its own phase. */
const TAB_CLICKS = ["VISUAL", "FAVOURITES", "MUSIC", "RADIO", "SOUND"];

// Passes are split on the "render end" log line, which only prints with DEBUG on.
// DEBUG starts off and its button is only reachable once the menu is open, so
// the replayed bundle starts with it on instead.
const DEBUG_DEFAULT = "let debug = false;";
const shipped = readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8");
if (!shipped.includes(DEBUG_DEFAULT)) {
    console.error(`  BATCHING GATE: dist/bundle.ts has no \`${DEBUG_DEFAULT}\`; the debug default moved, so passes cannot be split`);
    process.exit(1);
}
const bundle = shipped.replace(DEBUG_DEFAULT, "let debug = true;");
const BATCH_RE = /widgetsPerBatch: \d+,/;
if (!BATCH_RE.test(bundle)) {
    console.error("  BATCHING GATE: dist/bundle.ts has no `widgetsPerBatch: N,` in CONFIG; was the batching removed?");
    process.exit(1);
}
const unbatched = bundle.replace(BATCH_RE, "widgetsPerBatch: 1000000,");

async function run(source) {
    const s = await replay(source);
    try {
        const phases = ["boot", "deploy", "open"];
        s.start();
        await s.ticks(10);
        s.setPhase("deploy");
        s.deploy();
        await s.ticks(60);
        s.setPhase("open");
        s.aim();
        await s.ticks(60);
        for (const t of TAB_CLICKS) {
            // Tabs that do not exist yet in this build are skipped, not failed: the
            // gate is about batching, check-actions owns "every tab is wired".
            const phase = "tab " + t;
            s.setPhase(phase);
            try {
                s.click(t);
            } catch {
                continue;
            }
            phases.push(phase);
            await s.ticks(60);
        }
        const passes = {};
        for (const p of phases) passes[p] = createdPerPass(s.calls, p);
        const errors = s.logs.filter((l) => /error|exception|failed/i.test(l));
        return { passes, state: finalState(s.calls), errors };
    } finally {
        s.dispose();
    }
}

const problems = [];
const batched = await run(bundle);
const reference = await run(unbatched);

let worst = 0;
for (const [phase, list] of Object.entries(batched.passes)) {
    for (const n of list) {
        worst = Math.max(worst, n);
        if (n > MAX_PER_PASS) problems.push(`${phase}: one render pass created ${n} engine widgets (limit ${MAX_PER_PASS}); passes were ${list.join(" ")}`);
    }
}
for (const e of batched.errors) problems.push("script logged an error: " + e);

if (batched.state.length !== reference.state.length || batched.state.some((v, i) => v !== reference.state[i])) {
    const a = new Set(batched.state);
    const b = new Set(reference.state);
    const onlyA = batched.state.filter((v) => !b.has(v)).slice(0, 3);
    const onlyB = reference.state.filter((v) => !a.has(v)).slice(0, 3);
    problems.push(
        `batched final UI differs from unbatched (${batched.state.length} vs ${reference.state.length} widgets)` +
            `\n        batched only:   ${onlyA.join("\n                        ")}` +
            `\n        unbatched only: ${onlyB.join("\n                        ")}`
    );
}

const refWorst = Math.max(...Object.values(reference.passes).flat());
if (refWorst <= MAX_PER_PASS) {
    problems.push(`self-test: the unbatched bundle peaked at ${refWorst} widgets per pass, under the limit -- this gate would not catch the crash any more`);
}

if (problems.length > 0) {
    console.error("  BATCHING GATE:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
const summary = Object.entries(batched.passes)
    .map(([p, l]) => `${p}=[${l.join(",")}]`)
    .join(" ");
console.log(`  batching: peak ${worst} widgets/pass (limit ${MAX_PER_PASS}, unbatched ${refWorst}), final UI identical to unbatched (${batched.state.length} widgets)`);
console.log(`            ${summary}`);
