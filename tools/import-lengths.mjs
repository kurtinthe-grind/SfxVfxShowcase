// Imports recorded sound lengths into src/sound-lengths.json.
//
// The SDK gives no length for a sound. tabbedscamper recorded every
// RuntimeSpawn_Common SFX in game and measured each clip for the BF6 Portal
// SoundBoard: https://github.com/TabbedScamper/BF6_Portal_SoundBoard
// This reads that project's manifest.json and keeps only the measured numbers.
// No audio and no code is copied.
//
// Run only when the SDK adds sounds (tools/gen-catalog.mjs fails on a one-shot
// with no length). The output is committed, so a normal build does not need the
// SoundBoard checkout.
//
//   node tools/import-lengths.mjs [path/to/manifest.json]
//   default: ../BF6_Portal_SoundBoard-main/manifest.json
//
// What the numbers mean:
//   s       seconds of the recorded clip
//   cut     the recording harness gave each sound a fixed slot (10 s, 17 s for
//           Destruction), and the clip filled it: the real sound is at least s
//   silent  nothing audible was recorded
//   loop    the SoundBoard trimmed the clip to one seamless loop cycle, so s is
//           a loop period, not how long the sound plays

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const SRC = resolve(process.argv[2] ?? resolve(ROOT, "..", "BF6_Portal_SoundBoard-main", "manifest.json"));
const OUT = resolve(ROOT, "src", "sound-lengths.json");

// Slot ends seen in the recordings: one-shots 9 s + 0.6 s gap, Destruction 16 s.
// Clips at the slot end measure 10.00 and 17.00.
const slotEnd = (cat) => (cat === "Destruction" ? 17 : 10);

const manifest = JSON.parse(readFileSync(SRC, "utf8"));
const sounds = {};
for (const m of manifest) {
    // Announcer lines are PlayVO events, not RuntimeSpawn sounds; crash sounds are banned here.
    if (m.vo || m.crash) continue;
    if (!/^SFX_/.test(m.name) || typeof m.dur !== "number") throw new Error(`unexpected manifest entry ${JSON.stringify(m)}`);
    if (sounds[m.name] !== undefined) throw new Error(`${m.name} is in the manifest twice`);
    const e = { s: m.dur };
    if (!m.loop && m.dur >= slotEnd(m.cat) - 0.05) e.cut = true;
    if (m.silent) e.silent = true;
    if (m.loop) e.loop = true;
    sounds[m.name] = e;
}

const names = Object.keys(sounds).sort();
const lines = names.map((n, i) => `    ${JSON.stringify(n)}: ${JSON.stringify(sounds[n])}${i < names.length - 1 ? "," : ""}`);
const out =
    "{\n" +
    `  "source": "https://github.com/TabbedScamper/BF6_Portal_SoundBoard (manifest.json), by tabbedscamper",\n` +
    `  "note": "Measured lengths of in-game recordings, in seconds. Written by tools/import-lengths.mjs; see it for what cut, silent and loop mean.",\n` +
    `  "sounds": {\n${lines.join("\n")}\n  }\n}\n`;
writeFileSync(OUT, out, "utf8");
const count = (f) => names.filter((n) => sounds[n][f]).length;
console.log(`  wrote ${OUT}: ${names.length} sounds (${count("cut")} cut off by the recording slot, ${count("silent")} silent, ${count("loop")} loops)`);
