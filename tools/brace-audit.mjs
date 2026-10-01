// Finds which top-level declaration lost a closing brace.
//
// Uses the TypeScript scanner (which understands strings, template literals and
// comments) to count braces per top-level statement, so a declaration whose span
// does not balance to zero is identified precisely.
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
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

/** Net brace depth of a slice of source, ignoring strings and comments. */
function depthOf(slice) {
    const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, slice);
    let d = 0;
    for (;;) {
        const k = sc.scan();
        if (k === ts.SyntaxKind.EndOfFileToken) break;
        if (k === ts.SyntaxKind.OpenBraceToken) d++;
        else if (k === ts.SyntaxKind.CloseBraceToken) d--;
    }
    return d;
}

let bad = 0;
for (const st of sf.statements) {
    const start = st.getStart(sf);
    const end = st.getEnd();
    const d = depthOf(text.slice(start, end));
    if (d !== 0) {
        bad++;
        const name = st.name?.getText(sf) ?? ts.SyntaxKind[st.kind];
        console.log(`  ${rel}:${lineOf(start)}  ${ts.SyntaxKind[st.kind]} ${name}  net depth ${d > 0 ? "+" : ""}${d}`);
        const body = text.slice(start, end).split("\n");
        for (let i = 0; i < Math.min(body.length, 4); i++) console.log(`      | ${body[i]}`);
        console.log(`      ... ${body.length} lines total, last: ${JSON.stringify(body[body.length - 1])}`);
        console.log("");
    }
}
if (bad === 0) console.log(`  ${rel}: every top-level declaration balances`);
process.exit(bad === 0 ? 0 : 1);
