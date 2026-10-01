// Proves tools/check-invariants.mjs fails on each bug it guards.
//
// A gate nobody has watched fail is not a gate. Each case injects one of the three
// real defects, expects a non-zero exit with the matching message, and restores the
// file.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GATE = resolve(HERE, "check-invariants.mjs");
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
        // The old bug, re-created in the new architecture: someone "fixes" the
        // cursor by calling EnableUIInputMode by hand. It deadlocks the utils'
        // reference count, which is why the gate now requires the call to be absent.
        name: "input mode taken over manually",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace("    ui.open = open;", "    ui.open = open;\n    mod.EnableUIInputMode(true, ui.player);"),
        expect: /mod\.EnableUIInputMode is called directly/,
    },
    {
        // uiInputModeWhenVisible is the only thing that makes the root take the
        // cursor. Without it the menu opens and every click goes to the game.
        name: "root stops taking the cursor",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("uiInputModeWhenVisible: true", "uiInputModeWhenVisible: false"),
        expect: /never sets uiInputModeWhenVisible/,
    },
    {
        // bf6-portal-utils/ui owns OnPlayerUIButtonEvent. A second subscription
        // either double-fires or fights the utils' own router.
        name: "a second click subscription",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace(
            'import { Events } from "bf6-portal-utils/events";',
            'import { Events } from "bf6-portal-utils/events";\nEvents.OnPlayerUIButtonEvent.subscribe(() => {});'
        ),
        expect: /subscribes to OnPlayerUIButtonEvent/,
    },
    {
        // Every UITextButton needs an onClickUp. Losing it produces a button that
        // looks correct and swallows the click -- the exact original symptom.
        name: "buttons built without a click handler",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("onClickUp: () => {", "onClickUpDropped: () => {"),
        expect: /builds no onClickUp handler/,
    },
    {
        name: "ui.open assigned outside setOpen",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace("        setOpen(ui, false);", "        ui.open = false;"),
        expect: /assigns ui\.open outside setOpen/,
    },
    {
        // The query readout was positioned with absolute scene coordinates while the
        // key rows subtract kb.y, so the two used different origins and the readout
        // rendered 216px too low -- on top of the third key row, invisible while typing.
        // The scene data was correct throughout; ui.ts was the thing that was wrong.
        name: "query readout back on absolute coordinates",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("const qy = kb.queryY - kb.y;", "const qy = kb.queryY;"),
        expect: /positions the readout with absolute kb\.queryY/,
    },
    {
        // The keys are the reference implementation for the container-relative origin.
        // If they ever stop offsetting, the readout would be right and the keys wrong.
        name: "key rows stop offsetting by the container origin",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("kb.rowY[r] - kb.y", "kb.rowY[r]"),
        expect: /no longer offsets the key rows by kb\.y/,
    },
    {
        // An unarmed fire used to open the menu as a hint, which made fire a second
        // opener: both triggers opened the menu and neither read as "spawn".
        name: "an unarmed fire opens the menu again",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace(
            '        log("gadget fire: nothing armed (menu not opened)");',
            '        setOpen(st.ui, true);\n        log("gadget fire: nothing armed (menu not opened)");'
        ),
        expect: /the fire handler opens the menu/,
    },
    {
        name: "field Message stringified in rawProp",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("if (v !== undefined) return v;", "if (v !== undefined) return String(v);"),
        expect: /rawProp\(\) stringifies/,
    },
    {
        // The whole point of the export is the log. Routing it through the debug gate
        // lets a player silence the one feature they came for, and nothing about it
        // would look broken -- the button just quietly did nothing.
        name: "the export silenced by the debug switch",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace(/logAlways\(/g, "log("),
        expect: /export the player can mute|bypasses the debug switch/,
    },
    {
        // "Alarm" in the log is useless; "SFX_Alarm" is the name you paste into the
        // editor. This is the difference between the feature working and not.
        name: "the export logs display names",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace("rowRawName(r)", "rowDisplay(r)"),
        expect: /logs the display name|index-file member name/,
    },
    {
        // A Set would still export in insertion order, so nothing would look wrong --
        // but the order would become an accident of the container rather than
        // something the feature is built on.
        name: "favourites stored unordered",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("favourites: string[];", "favourites: Set<string>;"),
        expect: /not an ordered array/,
    },
    {
        name: "the shortlist is unreachable",
        file: IDX,
        original: idxOriginal,
        // Every copy: the tab handler tests the name twice.
        broken: idxOriginal.split('action === "tabFav"').join('action === "tabFavXX"'),
        expect: /does not handle tabFav/,
    },
    {
        // The real bug, re-created: the click handler resolves r<row>_<tag> against a
        // list it builds itself. On the favourites tab that list ignores the
        // shortlist, so clicking a saved asset's * addressed a different asset and
        // removing a favourite added one.
        name: "row buttons address a separately built list",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace(
            "const page = pageSlice(visibleList(ui), ui.page);",
            "const page = pageSlice(listFor(ui.tab, ui.group, filtersOf(ui)), ui.page);"
        ),
        expect: /does not use visibleList|ignores the shortlist entirely/,
    },
    {
        name: "row buttons lost their shared list",
        file: IDX,
        original: idxOriginal,
        broken: idxOriginal.replace("const page = pageSlice(visibleList(ui), ui.page);", "const page = [];"),
        expect: /does not use visibleList/,
    },
    {
        name: "group visibility cascade removed",
        file: UI,
        original: uiOriginal,
        broken: uiOriginal.replace("if (n.parent !== undefined && groupVisible[n.parent] === false) {", "if (false) {"),
        expect: /does not cascade group visibility/,
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
            console.error(`  GATE MISREPORTS: "${c.name}" failed without the expected message`);
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
