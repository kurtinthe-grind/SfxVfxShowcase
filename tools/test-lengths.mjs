// Behaviour test for recorded sound lengths (src/sound-lengths.json).
//
// Until 2026-10-02 every one-shot was stopped 2.5 s after it started, because the
// SDK gives no length for a sound. 174 one-shots are longer than that, so a
// building collapse (17 s) was cut off after its first crack. The lengths now come
// from tabbedscamper's in-game recordings. This replays dist/bundle.ts and checks:
//
//   - a one-shot row shows its length ("ONE 13.3s", "ONE 17s+" when the recording
//     itself was cut off), and a loop still shows LOOP;
//   - PLAY lets a long one-shot run for its whole length, and still stops it;
//   - PLAY plays a 3D sound at the player, for that player only. It used to play
//     at the map origin with no location, so 3D sounds were silent on PLAY
//     (often underground) while gadget fire worked;
//   - EXPORT FAVOURITES writes the length;
//   - the gadget cannot pile up long sounds: past CONFIG.maxSoundsPerPlayer the
//     oldest is stopped.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";

const TEXT_GEN = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
const CATALOG = readFileSync(resolve(ROOT, "src", "catalog.ts"), "utf8");
const CONFIG_TS = readFileSync(resolve(ROOT, "src", "config.ts"), "utf8");
const STRINGS = JSON.parse(readFileSync(resolve(ROOT, "dist", "bundle.strings.json"), "utf8"));
function labelKey(field) {
    const m = new RegExp(`\\b${field}: "(\\w+)"`).exec(TEXT_GEN);
    if (m === null) throw new Error(`text.gen.ts has no label ${field}`);
    return m[1];
}
const GAP2 = labelKey("gap2");
const PLAY = labelKey("play");
const SELECT = labelKey("select");
const FAV_ADD = labelKey("favAdd");
const EXPORT = labelKey("exportFavs");

const GROUP = "Destruction_Buildings";
const groupKey = new RegExp(`category: "${GROUP}", [^\\n]*catKey: "(sxg\\d+)"`).exec(CATALOG)?.[1];
if (groupKey === undefined) throw new Error(`catalog.ts has no ${GROUP} group`);
// Rows 0 and 4 of the group, in list order. Lengths from the recordings.
const CUT = { row: 0, name: "SFX_Destruction_Buildings_CrowsNest_Collapse_All_OneShot3D", badge: "ONE 17s+", minMs: 17000, export: "17s+" };
const LONG = { row: 4, name: "SFX_Destruction_Buildings_CrowsNest_Preamble_Distant_OneShot3D", badge: "ONE 13.3s", minMs: 13340, export: "13.3s" };
const maxSounds = Number(/maxSoundsPerPlayer: (\d+)/.exec(CONFIG_TS)?.[1]);
const problems = [];
if (!(maxSounds > 0)) problems.push("config.ts has no maxSoundsPerPlayer");

const s = await replay(readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8"));
const buttons = () => new Set(s.calls.filter((c) => c.name === "AddUIButton").map((c) => c.args[0]));
const text = (t) => STRINGS[t.msg[0]] ?? t.msg[0];
/** The kind badges (ONE... / LOOP) on the visible list rows, top to bottom. */
const badges = () =>
    s.visibleTexts()
        .filter((t) => t.y > LIST_TOP && t.y < LIST_BOTTOM && t.msg.length === 1 && /^(ONE|LOOP)\b/.test(text(t)))
        .map(text);
/**
 * Every sound of this asset: [{spawn, at, stoppedAt}] in virtual ms. The replay
 * records calls but not return values; the nth SpawnObject call returned
 * { spawn: n }, which is what StopSound later receives.
 */
function sounds(name) {
    const out = [];
    let n = 0;
    for (const c of s.calls) {
        if (c.name !== "SpawnObject") continue;
        n++;
        if (String(c.args[0]).endsWith("." + name)) out.push({ spawn: n, at: c.t, stoppedAt: undefined });
    }
    for (const c of s.calls) {
        if (c.name !== "StopSound") continue;
        const o = out.find((x) => x.spawn === c.args[0]?.spawn);
        if (o !== undefined && o.stoppedAt === undefined) o.stoppedAt = c.t;
    }
    return out;
}
// Stamp each recorded call with the virtual time it was made at.
let stamped = 0;
function stamp() {
    for (; stamped < s.calls.length; stamped++) s.calls[stamped].t = s.now();
}
async function ticks(n) {
    for (let i = 0; i < n; i++) {
        await s.ticks(1);
        stamp();
    }
}
const press = (key, nth = 0) => {
    s.clickText(key, nth);
    stamp();
};
const LIST_TOP = 290;
const LIST_BOTTOM = 770;
/** Presses the button labelled `key` on list row `row`; the header can show the same label above the list. */
const pressRow = (key, row) => {
    const b = buttons();
    const above = s.visibleTexts().filter((t) => t.msg[0] === key && b.has(t.parent + "_b") && t.y <= LIST_TOP).length;
    press(key, above + row);
};

/** Picks GROUP on the rail. Switching tabs clears the group, so this follows every return to SOUND. */
async function openGroup() {
    const railRows = s.visibleTexts().filter((t) => t.msg[0] === GAP2 && buttons().has(t.parent + "_b"));
    const nth = railRows.findIndex((t) => t.msg[1] === groupKey);
    if (nth < 0) throw new Error(`${GROUP} is not on the first rail page`);
    press(GAP2, nth);
    await ticks(40);
}

try {
    s.start();
    await ticks(5);
    s.deploy();
    await ticks(40);
    s.aim();
    await ticks(40);
    s.click("SOUND");
    await ticks(40);
    const loopBadge = badges()[0];
    if (loopBadge !== "LOOP") problems.push(`the first SOUND row (SFX_Alarm, a loop) shows ${JSON.stringify(loopBadge)}, expected LOOP`);

    await openGroup();

    // ---- badges
    const b = badges();
    for (const x of [CUT, LONG]) {
        if (b[x.row] !== x.badge) problems.push(`row ${x.row} (${x.name}) shows ${JSON.stringify(b[x.row])}, expected ${JSON.stringify(x.badge)}`);
    }

    // ---- PLAY runs the whole length, then stops
    for (const x of [CUT, LONG]) {
        pressRow(PLAY, x.row);
        const started = s.now();
        await ticks(Math.ceil(30000 / 16));
        const life = sounds(x.name).filter((o) => o.at >= started);
        if (life.length !== 1) {
            problems.push(`PLAY on ${x.name} spawned ${life.length} sounds, expected 1`);
            continue;
        }
        const o = life[0];
        const play = s.calls.find((c) => c.name === "PlaySound" && c.args[0]?.spawn === o.spawn);
        if (play === undefined) problems.push(`PLAY on ${x.name} never called PlaySound`);
        else if (play.args.length !== 5 || typeof play.args[3] !== "number" || play.args[4] !== s.player) {
            problems.push(`PLAY on ${x.name} (3D) called PlaySound with ${play.args.length} args; expected (sound, amplitude, location, range, player) so the player hears it where they stand`);
        }
        if (o.stoppedAt === undefined) problems.push(`${x.name} was never stopped (30 s later)`);
        else if (o.stoppedAt - o.at < x.minMs) problems.push(`${x.name} was stopped after ${o.stoppedAt - o.at} ms; the recording is ${x.minMs} ms`);
        else if (o.stoppedAt - o.at > x.minMs + 6000) problems.push(`${x.name} ran ${o.stoppedAt - o.at} ms; it should stop soon after its ${x.minMs} ms`);
    }

    // ---- EXPORT writes the length
    // Bottom row first: a favourited row's + turns into *, which renumbers the + buttons below it.
    pressRow(FAV_ADD, LONG.row);
    await ticks(20);
    pressRow(FAV_ADD, CUT.row);
    await ticks(20);
    s.click("FAVOURITES");
    await ticks(40);
    press(EXPORT);
    await ticks(20);
    for (const x of [CUT, LONG]) {
        const line = s.logs.find((l) => l.includes(x.name + " |"));
        const want = `${x.name} | ${GROUP} | SFX | ${x.export}`;
        if (line === undefined || !line.endsWith(want)) problems.push(`export line for ${x.name} is ${JSON.stringify(line)}, expected it to end ${JSON.stringify(want)}`);
    }

    // ---- the gadget cannot pile up long sounds
    s.click("SOUND");
    await ticks(40);
    await openGroup();
    pressRow(SELECT, CUT.row);
    await ticks(20);
    const fired = s.now();
    const shots = maxSounds + 4;
    for (let i = 0; i < shots; i++) {
        s.emit("OnRayCastHit", s.player, { v: [i, 0, 0] }, { v: [0, 1, 0] });
        await ticks(10);
    }
    const placed = sounds(CUT.name).filter((o) => o.at >= fired);
    const alive = placed.filter((o) => o.stoppedAt === undefined);
    if (placed.length !== shots) problems.push(`the gadget placed ${placed.length} sounds for ${shots} shots`);
    if (alive.length > maxSounds) problems.push(`${alive.length} placed sounds still play after ${shots} shots; the limit is ${maxSounds}`);
    const early = placed.slice(0, shots - maxSounds);
    if (early.some((o) => o.stoppedAt === undefined)) problems.push(`past the limit the oldest sounds should stop first; still playing: ${early.filter((o) => o.stoppedAt === undefined).map((o) => o.spawn).join(", ")}`);

    for (const l of s.logs) if (/UNHANDLED ACTION|error|exception/i.test(l)) problems.push("log: " + l);
} finally {
    s.dispose();
}

if (problems.length > 0) {
    console.error("  LENGTH BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log(`  lengths : rows show recorded lengths, PLAY plays 3D sounds at the player and runs their whole length, EXPORT writes it, at most ${maxSounds} placed sounds per player`);
