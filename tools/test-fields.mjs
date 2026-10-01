// Proves tools/check-fields.mjs fails on each bug it guards.
//
// Both of these shipped once and were only caught by reading a pasted in-game log.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GATE = resolve(HERE, "check-fields.mjs");
const UI = resolve(ROOT, "src", "ui.ts");
const GT = resolve(HERE, "gen-text.mjs");

const uiOriginal = readFileSync(UI, "utf8");
const gtOriginal = readFileSync(GT, "utf8");

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
        // The row's PLAY label. It used to be a bare glyph, and this case has been
        // retargeted as the row changed -- the defect class is the same, and the
        // gate is the only thing that proves it is still caught.
        name: "the PLAY label carries a raw CONFIG string",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("playLabel: K(T.play),", "playLabel: CONFIG.playGlyph,"),
        expect: /playLabel is a raw string/,
    },
    {
        name: "a field concatenates a bare literal",
        file: UI,
        original: uiOriginal,
        // Whole-line swap, so no producer call survives anywhere in the value.
        broken: uiOriginal.replace(
            /^\s*armed:.*$/m,
            '        armed: ui.armedKey === "" ? "NOTHING ARMED" : "ARMED: " + armedTextKey,'
        ),
        expect: /is a raw string/,
    },
    {
        name: "glyph letter drifts from config.ts",
        file: GT,
        original: gtOriginal,
        broken: gtOriginal.replace('playGlyph: "P",', 'playGlyph: "Q",'),
        expect: /playGlyph is "P" in config\.ts but "Q"/,
    },
    {
        name: "inline spec value stringified again",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace(
            "    return raw as string | number | mod.Message;",
            '    return typeof raw === "string" ? raw : String(raw);'
        ),
        expect: /rawProp\( stringifies a resolved value/,
    },
    {
        // There is no create order to get wrong any more, but there is still a
        // layer: BelowGameUI puts the widget under the game HUD and its clicks
        // land on the match instead.
        name: "a button pushed under the game HUD",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("depth: UI.Depth.AboveGameUI,", "depth: UI.Depth.BelowGameUI,"),
        expect: /puts an element in UI\.Depth\.BelowGameUI/,
    },
    {
        name: "a labelled button loses its label",
        file: UI,
        original: uiOriginal,
        broken: (() => {
            // Delimited the same way the gate delimits it -- to the first "})" after
            // the constructor opens -- rather than by a fixed character count. The
            // count was 1200 and the constructor grew past it when the focus handlers
            // were added, so the injection silently stopped matching.
            const at = uiOriginal.indexOf("new UITextButton({");
            if (at < 0) return uiOriginal;
            const end = uiOriginal.indexOf("})", at);
            if (end < 0) return uiOriginal;
            const body = uiOriginal.slice(at, end);
            // Whitespace-tolerant: the constructor was extracted to a local, so its
            // body re-indented, and a literal indent match stops firing the moment
            // anything above it is reformatted.
            const patched = body.replace(/^[ \t]*label: label,\n/m, "");
            if (patched === body) return uiOriginal;
            return uiOriginal.slice(0, at) + patched + uiOriginal.slice(end);
        })(),
        expect: /UITextButton is built without a label/,
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
    writeFileSync(UI, uiOriginal, "utf8");
    writeFileSync(GT, gtOriginal, "utf8");
}

const final = run();
if (final.code !== 0) {
    console.error("  GATE IS BROKEN: fails after the files were restored");
    console.error(final.out);
    failed++;
} else {
    console.log("  gate correctly passes once restored");
}
if (failed > 0) process.exit(1);
