// Developer view of the QR mapping, without the game.
//
//   npm run qr:inspect -- SFX_Alarm FX_BASE_Fire_M_NoSmoke   names -> IDs -> payload(s)
//   npm run qr:inspect -- "SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8"   payload or link -> names
//   npm run qr:inspect -- 0XG 0Y4                              bare IDs -> names
//
// In game, DEBUG ON logs the same transformation: "QR MAP <name> -> <ID>" for each
// favourite, then "QR TEXT i/n: <payload>" for each code.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./ui-replay.mjs";
import { loadMaps } from "./qr-helpers.mjs";
import { decode, ID_RE, namesOf, packPayloads } from "../site/js/codec.js";

const args = process.argv.slice(2);
if (args.length === 0) {
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 8).join("\n"));
    process.exit(0);
}
const { maps, current } = loadMaps();
const map = maps[current];
const site = /qrSite: "([^"]*)"/.exec(readFileSync(resolve(ROOT, "src", "config.ts"), "utf8"))[1];

function show(r) {
    console.log(`kind ${r.kind}, status ${r.status}, format ${r.formatVersion ?? "-"}, mapping ${r.mapping ?? "-"}, part ${r.part}/${r.of}, checksum ${r.kind === "compact" ? (r.checkOk ? "OK" : "BAD") : "-"}`);
    for (const m of [...r.errors, ...r.warnings]) console.log(`  ${m.code}: ${m.message}`);
    r.items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(3)}. ${(it.id ?? "").padEnd(4)} ${it.status.padEnd(9)} ${namesOf([it])[0]}`));
}

const isNameList = args.every((a) => !ID_RE.test(a) && !a.startsWith("SV") && !a.startsWith("http"));
if (!isNameList) {
    show(decode(args.join(args.every((a) => ID_RE.test(a)) ? "," : "\n"), maps, current));
    process.exit(0);
}

const byName = new Map();
for (const [id, e] of Object.entries(map.ids)) {
    byName.set(e.n, id);
    if (e.l !== undefined) byName.set(e.l, id);
}
const codes = [];
console.log("Full asset -> compact ID");
for (const name of args) {
    const id = byName.get(name);
    console.log(`  ${name} -> ${id ?? "NOT IN MAPPING " + current}`);
    if (id !== undefined) codes.push(id);
}
const payloads = packPayloads(codes, { mapping: current, prefix: site === "" ? "" : site + "#" });
console.log(`QR payload${payloads.length > 1 ? "s" : ""} (passed to UIQRCode):`);
for (const p of payloads) console.log(`  ${p}  (${p.length} bytes)`);
const full = args.join("\n").length;
console.log(`Full names would be ${full} bytes; the compact payload is ${payloads.reduce((n, p) => n + p.length, 0)} bytes with the URL.`);
