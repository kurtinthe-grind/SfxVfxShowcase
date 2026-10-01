// Writes src/music.gen.ts and src/musickeys.json from the Tier 0 music enums.
//
// The MUSIC / RADIO tester lists every music event and parameter the SDK has.
// Reading them out of types_original/mod/index.d.ts -- the absolute source of
// truth (AGENT.md 2.1) -- instead of keeping a hand list means a new SDK member
// appears after `npm run gen`, and a removed one becomes a compile error.
//
// Grouping is by name prefix: Core_, BR_, Gauntlet_, Radio_. BRGauntlet_* is
// listed under BR. UNVERIFIED: the SDK does not say which package owns it, and
// the tester loads every package anyway, so the grouping only affects the menu.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const TYPES = resolve(ROOT, "..", "main_resources", "types_original", "mod", "index.d.ts");
const OUT_TS = resolve(ROOT, "src", "music.gen.ts");
const OUT_KEYS = resolve(ROOT, "src", "musickeys.json");

// Parameter ranges, from the MusicParams JSDoc in bf6-portal-mod-types
// (enums.d.ts). Anything missing here falls back to DEFAULT_SPEC and is reported,
// so a new SDK param is never silently unusable.
const SPEC = {
    // "effectively a boolean ... takes in a number 0 or 1"
    Core_IsWinning: { min: 0, max: 1, step: 1, def: 0 },
    // "0 ... does not use sectors (e.g. Conquest), or use values 1, 2, or 3"
    Core_Sector: { min: 0, max: 3, step: 1, def: 0 },
    // "clamped to a range between 0 and 4 ... decimals ... act as a crossfade"
    Core_Urgency: { min: 0, max: 4, step: 0.5, def: 0 },
    // "clamped to a range between 0 and 3"
    Core_PhaseUrgency: { min: 0, max: 3, step: 0.5, def: 0 },
    // "a timer from 10 to 0 ... only need to set this timer once"
    BRGauntlet_LobbyTimerRemaining: { min: 0, max: 10, step: 1, def: 10 },
    // 0 Hip Hop, 1 Rock, 2 BF Themes, 3 Reggaeton, 4 Biome, 5 Classical, 6 Pop
    Radio_Channel: { min: 0, max: 6, step: 1, def: 2 },
    // 0 Gibraltar .. 6 Turkmenistan; only used on channel 4
    Radio_Biome: { min: 0, max: 6, step: 1, def: 0 },
    // "Select which track to add next in the queue" -- largest station has 32
    // Setting it QUEUES that track, so the stepper only picks the number and the
    // tester's QUEUE TRACK button sends it (queues: true).
    Radio_QueueTrackNumber: { min: 0, max: 31, step: 1, def: 0, queues: true },
    Radio_LoopQueuedTracks: { min: 0, max: 1, step: 1, def: 1 },
    Radio_ContinueQueueOnTrackEnd: { min: 0, max: 1, step: 1, def: 1 },
};
// One-line on-screen descriptions, shown under the selected track and under
// each param row. Written from the SDK docs (gameplay_logic.html, "Music
// Events" and "MusicParams"); "One-shot track." alone in the docs is expanded
// from the event's name. Every listed event and param must have one, at most
// DESC_MAX characters (one line on the panel), ASCII only.
const DESC_MAX = 96;
const DESC = {
    // Core
    Core_Deploy_Loop: "Quiet, ambient loop, played while players are deploying.",
    Core_EndOfRound_Loop: "End-of-match loop. Core_IsWinning and Core_Sector pick the version.",
    Core_LastPhaseBegin: "One-shot track for the start of the last phase.",
    Core_Overtime_Loop: "Quiet, suspenseful loop for overtime, e.g. capturing a point in overtime.",
    Core_PauseMenu_Loop: "Quiet, ambient loop for the pause menu.",
    Core_PhaseBegin: "One-shot for the start of a phase. Core_IsWinning and Core_Sector pick the version.",
    Core_PhaseEnded: "One-shot for the end of a phase. Core_IsWinning and Core_Sector pick the version.",
    Core_Stinger_Negative: "Short negative sting, played mid-match.",
    Core_Stinger_Positive: "Short positive sting, played mid-match.",
    Core_Stinger_RankUp: "Sting played at the end of a match when you rank up.",
    Core_IsWinning: "0 = losing, 1 = winning. Picks the version of PhaseBegin, PhaseEnded and EndOfRound.",
    Core_PhaseUrgency: "Above 0, end-of-phase tension music starts at once. Each whole number adds a layer.",
    Core_Sector: "0 = no sectors (Conquest). 1 to 3 = that sector's music (Breakthrough).",
    Core_Urgency: "Above 0, end-of-round tension music starts at once. Each whole number adds a layer.",
    // BR (BRGauntlet_* is shared with Gauntlet)
    BR_InsertionCinematic_Dropzone_Loop: "Drop zone loop. InsertionCinematic_Loop turns into it; play it to skip ahead.",
    BR_InsertionCinematic_Loop: "Insertion one-shot that turns into the drop zone loop after a few seconds.",
    BR_InsertionJump: "One-shot for jumping out at insertion.",
    BR_InsertionLanding: "One-shot for landing after insertion.",
    BR_LastTwoSquads: "One-shot, played when you are in the last two squads.",
    BR_Loss_Early_Loop: "Loop for being eliminated before the end of the round.",
    BR_Loss_EndOfRound_Loop: "Loop for losing at the end of the round in third place or worse.",
    BR_Loss_SecondPlace_Loop: "Loop for finishing the round in second place.",
    BR_Pause: "Pauses whatever BR music is playing.",
    BR_RespawnSecondChance: "One-shot for a second-chance respawn.",
    BR_RespawnTower: "One-shot for a respawn tower.",
    BR_Unpause: "Resumes paused BR music.",
    BR_WonRound_Loop: "Loop for winning the round.",
    BRGauntlet_LobbyFilled: "Plays when the lobby fills. Set BRGauntlet_LobbyTimerRemaining before playing it.",
    BRGauntlet_WaitingForPlayers_Loop: "Quiet loop while waiting for players in the lobby.",
    BRGauntlet_LobbyTimerRemaining: "Lobby countdown, 10 to 0, used by BRGauntlet_LobbyFilled. Set it once, then play that.",
    // Gauntlet
    Gauntlet_Deploy: "One-shot for deploying.",
    Gauntlet_Loss_FinalMission_Loop: "Loop for losing the final mission.",
    Gauntlet_Loss_Loop: "Loop for losing any mission except the final one.",
    Gauntlet_MissionBriefing_Final: "One-shot for the final mission briefing.",
    Gauntlet_MissionBriefing_One: "One-shot for the first mission briefing.",
    Gauntlet_MissionBriefing_Three: "One-shot for the third mission briefing.",
    Gauntlet_MissionBriefing_Two: "One-shot for the second mission briefing.",
    Gauntlet_Pause: "Pauses whatever Gauntlet music is playing.",
    Gauntlet_Qualified_Loop: "Loop for qualifying. Play Qualified_Outro next for a smooth ending.",
    Gauntlet_Qualified_Outro: "One-shot outro. Follows Qualified_Loop smoothly, or plays on its own.",
    Gauntlet_Unpause: "Resumes paused Gauntlet music.",
    Gauntlet_Urgency: "Long urgency one-shot, 35 seconds.",
    Gauntlet_Urgency_FinalMission: "Long urgency one-shot for the final mission, 35 seconds.",
    Gauntlet_WonOperation_Loop: "Loop for winning the operation.",
    // Radio
    Radio_ClearQueue: "Empties the queue. The only way to remove queued tracks.",
    Radio_NextQueuedTrack: "Skips to the next queued track.",
    Radio_Play: "Plays the queued tracks on the selected channel. An empty queue plays nothing.",
    Radio_Biome: "Which region's radio station. Only used on channel 4.",
    Radio_Channel: "Station: 0 Hip Hop, 1 Rock, 2 BF Themes, 3 Reggaeton, 4 by biome, 5 Classical, 6 Pop.",
    Radio_ContinueQueueOnTrackEnd: "1 = play the next queued track when one ends. 0 = stop after each track.",
    Radio_LoopQueuedTracks: "1 = start the queue over after the last track. 0 = stop at the end.",
    Radio_QueueTrackNumber: "Track to add, from 0. QUEUE TRACK adds it, then moves on to the next track.",
};

// "0 is silent, 1 is the full default volume ... clamped from 0 to 3"
const AMP_SPEC = { min: 0, max: 3, step: 0.1, def: 1 };
const DEFAULT_SPEC = { min: 0, max: 10, step: 1, def: 0 };

/** The UI has this many param rows; gen fails if a package needs more. */
const PARAM_SLOTS = 5;

function readEnum(src, name) {
    const start = src.indexOf(`export enum ${name} {`);
    if (start < 0) throw new Error(`index.d.ts has no enum ${name}`);
    const body = src.slice(start + `export enum ${name} {`.length, src.indexOf("}", start));
    return body
        .split("\n")
        .map((l) => l.trim().replace(/,$/, ""))
        .filter((l) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(l));
}

function packageOf(member) {
    if (member.startsWith("BRGauntlet_") || member.startsWith("BR_")) return "BR";
    const p = member.slice(0, member.indexOf("_"));
    return p;
}

const src = readFileSync(TYPES, "utf8");
const packages = readEnum(src, "MusicPackages");
const events = readEnum(src, "MusicEvents");
const params = readEnum(src, "MusicParams");

const problems = [];
const pairs = [];
let n = 0;
const keyFor = (text) => {
    const key = "sxM" + String(n++).padStart(2, "0");
    pairs.push({ key, text });
    return key;
};
// Descriptions get their own prefix so adding one never renumbers a name key.
let nd = 0;
const descs = {};
const descFor = (name) => {
    const text = DESC[name];
    if (text === undefined) {
        problems.push(`${name} has no description in gen-music.mjs DESC`);
        return "";
    }
    if (text.length > DESC_MAX) problems.push(`${name} description is ${text.length} chars, max ${DESC_MAX} (one panel line)`);
    if (/[^\x20-\x7e]/.test(text)) problems.push(`${name} description is not plain ASCII`);
    const key = "sxD" + String(nd++).padStart(2, "0");
    pairs.push({ key, text });
    descs[name] = text;
    return key;
};

const out = [];
for (const pkg of packages) {
    const evts = events.filter((e) => packageOf(e) === pkg);
    const stops = evts.filter((e) => /_Stop$/.test(e));
    const list = evts.filter((e) => !/_Stop$/.test(e));
    const ps = params.filter((p) => packageOf(p) === pkg);
    const amps = ps.filter((p) => /_Amplitude$/.test(p));
    const rows = ps.filter((p) => !/_Amplitude$/.test(p));
    if (!packages.includes(pkg)) problems.push(`package ${pkg} is not a MusicPackages member`);
    if (stops.length !== 1) problems.push(`package ${pkg} has ${stops.length} *_Stop events, expected 1`);
    if (amps.length !== 1) problems.push(`package ${pkg} has ${amps.length} *_Amplitude params, expected 1`);
    if (rows.length > PARAM_SLOTS) problems.push(`package ${pkg} has ${rows.length} params, the UI has ${PARAM_SLOTS} rows`);
    for (const p of rows) if (SPEC[p] === undefined) problems.push(`param ${p} has no range in gen-music.mjs SPEC (would use ${JSON.stringify(DEFAULT_SPEC)})`);
    out.push({
        name: pkg,
        key: keyFor(pkg.toUpperCase()),
        stop: stops[0],
        stopKey: keyFor(stops[0]),
        events: list.map((e) => ({ name: e, key: keyFor(e), desc: descFor(e) })),
        amp: { name: amps[0], key: keyFor(amps[0]), desc: "", ...AMP_SPEC },
        params: rows.map((p) => ({ name: p, key: keyFor(p), desc: descFor(p), ...(SPEC[p] ?? DEFAULT_SPEC) })),
    });
}
const assigned = new Set(out.flatMap((p) => [p.stop, ...p.events.map((e) => e.name)]));
for (const e of events) if (!assigned.has(e)) problems.push(`event ${e} matched no package`);
const assignedP = new Set(out.flatMap((p) => [p.amp.name, ...p.params.map((x) => x.name)]));
for (const p of params) if (!assignedP.has(p)) problems.push(`param ${p} matched no package`);
for (const name of ["Core", "BR", "Gauntlet", "Radio"]) if (!packages.includes(name)) problems.push(`MusicPackages has no ${name}`);
for (const name of Object.keys(DESC)) if (descs[name] === undefined) problems.push(`DESC has ${name}, which is not a listed event or param`);

if (problems.length > 0) {
    console.error("  MUSIC BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}

const q = JSON.stringify;
const L = [];
L.push("// GENERATED by tools/gen-music.mjs from types_original/mod/index.d.ts -- do not edit.");
L.push("//");
L.push("// Every music package, its events, its parameters and their documented ranges.");
L.push("// `key` fields are strings.json keys for the on-screen names.");
L.push("");
L.push("export interface MusicParamSpec {");
L.push("    readonly name: string;");
L.push("    readonly param: mod.MusicParams;");
L.push("    readonly key: string;");
L.push("    readonly min: number;");
L.push("    readonly max: number;");
L.push("    readonly step: number;");
L.push("    readonly def: number;");
L.push("    /** Sending this param queues a track: steppers must not send it. */");
L.push("    readonly queues: boolean;");
L.push("    /** strings.json key of the one-line description (empty for amplitudes: VOLUME has its own). */");
L.push("    readonly desc: string;");
L.push("}");
L.push("");
L.push("export interface MusicEventSpec {");
L.push("    readonly name: string;");
L.push("    readonly event: mod.MusicEvents;");
L.push("    readonly key: string;");
L.push("    /** strings.json key of the one-line description. */");
L.push("    readonly desc: string;");
L.push("}");
L.push("");
L.push("export interface MusicPackageSpec {");
L.push("    readonly name: string;");
L.push("    readonly pkg: mod.MusicPackages;");
L.push("    readonly key: string;");
L.push("    /** The package's own *_Stop event, sent by STOP. Not in `events`. */");
L.push("    readonly stop: mod.MusicEvents;");
L.push("    readonly stopKey: string;");
L.push("    readonly events: readonly MusicEventSpec[];");
L.push("    /** The package's *_Amplitude param: the VOLUME control. Not in `params`. */");
L.push("    readonly amp: MusicParamSpec;");
L.push("    readonly params: readonly MusicParamSpec[];");
L.push("}");
L.push("");
L.push(`export const PARAM_SLOTS = ${PARAM_SLOTS};`);
L.push("");
const param = (p) =>
    `{ name: ${q(p.name)}, param: mod.MusicParams.${p.name}, key: ${q(p.key)}, min: ${p.min}, max: ${p.max}, step: ${p.step}, def: ${p.def}, queues: ${p.queues === true}, desc: ${q(p.desc)} }`;
L.push("export const MUSIC_PACKAGES: readonly MusicPackageSpec[] = [");
for (const p of out) {
    L.push("    {");
    L.push(`        name: ${q(p.name)},`);
    L.push(`        pkg: mod.MusicPackages.${p.name},`);
    L.push(`        key: ${q(p.key)},`);
    L.push(`        stop: mod.MusicEvents.${p.stop},`);
    L.push(`        stopKey: ${q(p.stopKey)},`);
    L.push("        events: [");
    for (const e of p.events) L.push(`            { name: ${q(e.name)}, event: mod.MusicEvents.${e.name}, key: ${q(e.key)}, desc: ${q(e.desc)} },`);
    L.push("        ],");
    L.push(`        amp: ${param(p.amp)},`);
    L.push("        params: [");
    for (const x of p.params) L.push(`            ${param(x)},`);
    L.push("        ],");
    L.push("    },");
}
L.push("];");
L.push("");
writeFileSync(OUT_TS, L.join("\n"));
// `desc` (name -> text) is for the browser preview; gen-text reads only `pairs`.
writeFileSync(OUT_KEYS, JSON.stringify({ pairs, desc: descs }, null, 1) + "\n");

const counts = out.map((p) => `${p.name} ${p.events.length} events/${p.params.length} params`).join(", ");
console.log(`  music   : ${counts}`);
console.log(`  wrote ${OUT_TS}`);
