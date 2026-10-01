// Proves tools/check-actions.mjs fails on each way the action contract can break.
//
// The three cases are the actual defects found during the utils migration. All
// three compiled, all three typechecked, and all three produced a dead button with
// no diagnostic -- which is precisely why the gate exists.
//
// A fourth case covers the reverse: a handler that survives a rename on the ui.ts
// side only. That one used to be invisible too.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GATE = resolve(HERE, "check-actions.mjs");
const IDX = resolve(ROOT, "src", "index.ts");
const UI = resolve(ROOT, "src", "ui.ts");

const idxOriginal = readFileSync(IDX, "utf8");
const uiOriginal = readFileSync(UI, "utf8");

function run() {
    try {
        execFileSync(process.execPath, [GATE], { cwd: ROOT, stdio: "pipe" });
        return { code: 0, out: "" };
    } catch (e) {
        return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
}

const CASES = [
    {
        // The bottom row emitted "spc" while handle() tested "kbdspc". The click
        // fell through every branch and returned silently.
        name: "bottom row renamed on one side only",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace('if (action === "spc") {', 'if (action === "kbdspc") {'),
        expect: /does not handle \d+ scene action/,
    },
    {
        // The rail emitted "rail0" while handle() parsed "c0". Worse than inert: the
        // unmatched action then reached the c* branch, parseInt("ail0") was NaN, and
        // it still returned without a word.
        name: "rail prefix renamed on the emit side",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace('const action = "rail" + gi;', 'const action = "c" + gi;'),
        expect: /does not handle \d+ scene action|no longer builds the rail/,
    },
    {
        // The ALL row is the only way back from a picked group. Without its
        // rail0 action it would emit its handle key, which nothing handles.
        name: "rail ALL row loses its rail0 action",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace(', () => "rail0");', ");"),
        expect: /no longer builds the rail ALL row as a button emitting rail0/,
    },
    {
        // The reverse: handle() keeps testing a name ui.ts stopped emitting. No
        // button is dead, so only the dead-code direction of the gate can see it.
        name: "a handler survives an emit-side rename",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace('"btnSearch", parent,', '"btnSearchX", parent,'),
        expect: /nothing can emit/,
    },
    {
        // The runtime backstop is what makes a future mismatch visible in game. If it
        // is removed, the static gate still passes -- and a new break would be
        // silent again.
        name: "the unhandled-action log removed",
        file: IDX,
        original: idxOriginal,
        // Every copy: the mt* branch has its own.
        broken: idxOriginal.split('log(\`UNHANDLED ACTION "\${action}" (open=\${ui.open} tab=\${ui.tab})\`);').join(""),
        expect: /does not log an unhandled action/,
    },
];

let failed = 0;
try {
    for (const c of CASES) {
        if (c.broken === c.original) {
            console.error(`  SETUP ERROR: ${c.name} -- the injection did not change the file`);
            failed++;
            continue;
        }
        writeFileSync(c.file, c.broken, "utf8");
        const r = run();
        if (r.code === 0) {
            console.error(`  GATE IS BROKEN: passed "${c.name}"`);
            failed++;
        } else if (!c.expect.test(r.out)) {
            console.error(`  GATE MISREPORTS: "${c.name}"`);
            console.error(r.out);
            failed++;
        } else {
            const line = r.out.split("\n").find((l) => c.expect.test(l)) ?? "";
            console.log(`  caught: ${c.name}`);
            console.log(`    ${line.trim()}`);
        }
        writeFileSync(c.file, c.original, "utf8");
    }
} finally {
    writeFileSync(IDX, idxOriginal, "utf8");
    writeFileSync(UI, uiOriginal, "utf8");
}

const final = run();
if (final.code !== 0) {
    console.error("  GATE IS BROKEN: fails after the files were restored");
    console.error(final.out);
    failed++;
} else {
    console.log("  gate correctly passes once restored");
}

if (failed > 0) {
    console.error(`  ${failed} problem(s) with the gate itself`);
    process.exit(1);
}
