// Comment cleanup, with a dry run.
//
// Policy, after two attempts:
//
//   KEEP  the file header -- it orients a reader and records that the preview is
//         layout-only, and that Portal has no text-input API, which is the only
//         reason the search field is a grid of buttons at all.
//   KEEP  every one-line JSDoc. They are documentation, they are short, and they say
//         what the name does not. A first pass stripped these and the file got worse.
//   KEEP  any comment recording a constraint the code cannot express: the
//         EnableUIInputMode reference-counting rule, hover not being supported by the
//         package, the container-relative origin, the chip/slot collision, order
//         being a feature of favourites, logAlways bypassing the debug switch.
//   KEEP  any line that reads like a sentence continuation. An earlier pass dropped
//         "chips, SEARCH, the keyboard), and String() on an opaque Message gives"
//         and left the sentence above it dangling.
//   DROP  section banners that restate the next line's name.
//   DROP  standalone line comments that restate the code.
//
// The gates are the real defence now: they encode these rules in a form that fails
// the build, which a comment never did.
//
//   node tools/strip-comments.mjs          report only
//   node tools/strip-comments.mjs --write  apply
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "src");
const APPLY = process.argv.includes("--write");

const LOAD_BEARING = [
    /EnableUIInputMode/,
    /reference.?count/i,
    /[Hh]over/,
    /not supported/,
    /no (keyboard|text-input|UI event)/,
    /LAYOUT-ONLY|layout-only/,
    /kb\.y|absolute scene coordinates|container-relative/,
    /uiInputModeWhenVisible/,
    /bf6-portal-utils/,
    /AGENT\.md/,
    /strings\.json|strings table/,
    /MISSING TEXT KEY/,
    /\[object Object\]/,
    /mod\.Message/,
    /order is the (point|feature)/,
    /logAlways/,
    /PortalLog/,
    /console\.log/,
    /collision|collide/,
    /hit.?test/,
    /MAX_BUTTONS|MAX_ELEMENTS/,
    /only sounds this mod|this mod owns/,
    /index-file/,
    /one button per slot|keyed by slot/,
    /shortlist/i,
    /QuickJS/,
    /Tier 0/,
    /AddUIButton|SetUITextLabel|GetUIWidgetName/,
    /owns? (OnPlayerUIButtonEvent|that event)/,
    /deadlock/i,
    /opens the menu|raycast|second opener|arm-first|nothing armed/,
    /setOpen\(/,
    /whole tab IS the selection|whole tab is the selection/,
    /three-way|unarmed fire|pulls? the trigger/,
    /Never delete a widget/,
    /Page 1|Page 2|prefixes, so nobody has to type/,
    /Row actions:|Filter chips:|Simulated keyboard:/,
    /Audition without arming/,
    /close over|own origin/,
    /Structure-of-Arrays|generational/,
];

// A standalone comment starts a thought. Anything else is mid-sentence.
const STANDALONE = /^\/\/\s*(?:[-=*]{5,}|[A-Z0-9`([])/;
const BANNER = /^\/\/\s*[-=*]{5,}\s*$/;

const FILES = ["ui.ts", "index.ts", "diag.ts", "config.ts"];
let totalBefore = 0;
let totalAfter = 0;

for (const name of FILES) {
    const p = resolve(SRC, name);
    const body = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    const lines = body.split("\n");

    let headerEnd = 0;
    while (headerEnd < lines.length && lines[headerEnd].trim() === "") headerEnd++;
    if (lines[headerEnd] !== undefined && lines[headerEnd].trim().startsWith("//")) {
        while (headerEnd < lines.length && lines[headerEnd].trim().startsWith("//")) headerEnd++;
    }

    const keep = (t) => LOAD_BEARING.some((k) => k.test(t));
    const out = [];
    const gone = [];
    let inBlock = false;
    let block = [];

    const flush = (keepIt) => {
        if (keepIt) out.push(...block);
        else for (const b of block) if (b.trim().startsWith("//")) gone.push(b.trim());
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();

        if (i < headerEnd) {
            out.push(line);
            continue;
        }

        if (inBlock) {
            block.push(line);
            if (t.endsWith("*/")) {
                inBlock = false;
                const text = block.join("\n");
                // Short blocks are field/function documentation. Long ones are prose
                // that grew around code whose shape already says what it does.
                flush(block.length <= 4 || keep(text));
                block = [];
            }
            continue;
        }
        if (t.startsWith("/*") && !t.endsWith("*/")) {
            inBlock = true;
            block = [line];
            continue;
        }
        if (t.startsWith("/*") && t.endsWith("*/")) {
            // A one-line JSDoc is documentation. Always keep it.
            flush(keep(t) || t.length < 140);
            continue;
        }
        if (t.startsWith("//")) {
            // A run of // lines is one comment. Deciding line by line shredded
            // multi-line comments: the lines that happened to contain a keyword
            // survived and the rest went, leaving the sentence unreadable.
            let end = i;
            while (end + 1 < lines.length && lines[end + 1].trim().startsWith("//")) end++;
            const run = lines.slice(i, end + 1);
            const text = run.join("\n");
            const isBanner = run.every((r) => BANNER.test(r.trim()));
            const allStandalone = run.every((r) => STANDALONE.test(r.trim()));
            if (keep(text) || isBanner || !allStandalone) out.push(...run);
            else for (const r of run) gone.push(r.trim());
            i = end;
            continue;
        }
        out.push(line);
    }

    const text = out.join("\n").replace(/\n{3,}/g, "\n\n");
    const count = (s) => (s.match(/^\s*(\/\/|\/\*)/gm) ?? []).length;
    const b = count(body);
    const a = count(text);
    totalBefore += b;
    totalAfter += a;

    console.log(`  ${name}: ${b} -> ${a} comment lines (${gone.length} dropped)`);
    const SHOW = process.env.SHOW;
    if (APPLY) writeFileSync(p, text, "utf8");
    else if (SHOW === name) process.stdout.write(text);
    else for (const g of gone) console.log(`      - ${g.slice(0, 94)}`);
}

console.log(`\n  total ${totalBefore} -> ${totalAfter} comment lines`);
if (!APPLY) console.log("  dry run -- nothing written. pass --write to apply.");
