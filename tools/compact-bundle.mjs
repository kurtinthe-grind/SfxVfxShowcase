// Shrinks dist/bundle.ts under Portal's 1 MB script limit: drops comments, indentation
// and blank lines. Keeps the "@ts-nocheck" and "--- SOURCE:" marker lines.
//
// Proof it changed nothing: both versions are compiled with TypeScript and the emitted
// code must be identical, or the step fails and leaves the bundle as it was.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(ROOT, "dist", "bundle.ts");
export const LIMIT = 1_000_000;

const KEEP_COMMENT = /^\/\/ (@ts-nocheck|--- )/;
// A "/" after one of these is division; anywhere else it starts a regex.
const ENDS_VALUE = new Set([
    ts.SyntaxKind.Identifier, ts.SyntaxKind.PrivateIdentifier, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.StringLiteral, ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateTail, ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.SuperKeyword,
    ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword,
    ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken,
]);

export function compact(text) {
    const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
    let out = "";
    let prev = ts.SyntaxKind.Unknown;
    const braces = [];
    const atLineStart = () => out === "" || out.endsWith("\n");
    const newline = () => {
        if (out.endsWith(" ")) out = out.slice(0, -1);
        if (!atLineStart()) out += "\n";
    };
    for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
        switch (k) {
            case ts.SyntaxKind.NewLineTrivia:
                newline();
                continue;
            case ts.SyntaxKind.WhitespaceTrivia:
                if (!atLineStart() && !out.endsWith(" ")) out += " ";
                continue;
            case ts.SyntaxKind.SingleLineCommentTrivia:
                if (KEEP_COMMENT.test(sc.getTokenText())) out += sc.getTokenText();
                else if (out.endsWith(" ")) out = out.slice(0, -1);
                continue;
            case ts.SyntaxKind.MultiLineCommentTrivia:
                if (/[\r\n]/.test(sc.getTokenText())) newline();
                else if (!atLineStart() && !out.endsWith(" ")) out += " ";
                continue;
            case ts.SyntaxKind.ShebangTrivia:
            case ts.SyntaxKind.ConflictMarkerTrivia:
                throw new Error("compact-bundle: unexpected trivia " + ts.SyntaxKind[k]);
        }
        if ((k === ts.SyntaxKind.SlashToken || k === ts.SyntaxKind.SlashEqualsToken) && !ENDS_VALUE.has(prev)) {
            k = sc.reScanSlashToken();
        } else if (k === ts.SyntaxKind.TemplateHead) {
            braces.push("${");
        } else if (k === ts.SyntaxKind.OpenBraceToken) {
            braces.push("{");
        } else if (k === ts.SyntaxKind.CloseBraceToken) {
            if (braces.at(-1) === "${") {
                k = sc.reScanTemplateToken(false);
                if (k === ts.SyntaxKind.TemplateTail) braces.pop();
            } else {
                braces.pop();
            }
        }
        out += sc.getTokenText();
        prev = k;
    }
    return out.trimEnd() + "\n";
}

/** Compiled JS with comments removed: identical for two sources that differ only in trivia. */
export function emitted(text) {
    return ts.transpileModule(text, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: true },
        reportDiagnostics: false,
    }).outputText;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const before = readFileSync(FILE, "utf8");
    const after = compact(before);
    if (emitted(before) !== emitted(after)) {
        console.error("  compact : compacting changed the compiled code; dist/bundle.ts left as it was");
        process.exit(1);
    }
    writeFileSync(FILE, after);
    const size = Buffer.byteLength(after);
    console.log(`  compact : dist/bundle.ts ${Buffer.byteLength(before)} -> ${size} bytes (limit ${LIMIT}), compiled code identical`);
    if (size >= LIMIT) {
        console.error(`  compact : dist/bundle.ts is ${size} bytes, over Portal's ${LIMIT}-byte limit`);
        process.exit(1);
    }
    const strings = readFileSync(resolve(ROOT, "dist", "bundle.strings.json")).length;
    if (strings >= LIMIT) {
        console.error(`  compact : dist/bundle.strings.json is ${strings} bytes, over Portal's ${LIMIT}-byte limit`);
        process.exit(1);
    }
}
