// Pinpoints a structural break in a TS file using the real TypeScript parser.
//
// A hand-rolled brace count is unreliable here because the sources contain
// apostrophes inside comments ("player's"), which look like unterminated strings.
// ts.createSourceFile records the exact position where the parser gave up, which
// is what we need after a mechanical edit.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const require = createRequire(resolve(ROOT, "package.json"));
const ts = require("typescript");

const rel = process.argv[2] ?? "src/ui.ts";
const file = resolve(ROOT, rel);
const text = readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const diags = sf.parseDiagnostics ?? [];
if (diags.length === 0) {
    console.log(`  ${rel}: parses cleanly (${text.split("\n").length} lines)`);
    process.exit(0);
}

const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const lines = text.split("\n");

for (const d of diags.slice(0, 6)) {
    const ln = lineOf(d.start);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    console.log(`  ${rel}:${ln}  ${msg}`);
    if (ln >= 1 && ln <= lines.length) {
        const from = Math.max(0, ln - 4);
        const to = Math.min(lines.length, ln + 2);
        for (let i = from; i < to; i++) {
            console.log(`    ${String(i + 1).padStart(5)} ${i + 1 === ln ? ">" : " "} ${lines[i]}`);
        }
    }
    console.log("");
}
process.exit(1);
