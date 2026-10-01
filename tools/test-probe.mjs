// Replay test for probe/MusicProbe.ts, the music control experiment.
//
// WHY: four tester builds played no music in game (2026-10-01), even 24 s after
// LoadMusic, while the user's other experiences play music. The probe copies
// the official examples verbatim, with no UI and no bf6-portal-utils, so one run
// in the same sandbox experience tells whether the base mode or this mod is
// silent. This test locks the probe's exact calls and timeline, so what the user
// hears at "stage N" maps to known calls.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";

const PROBE = resolve(ROOT, "probe", "MusicProbe.ts");
const STRINGS = resolve(ROOT, "probe", "MusicProbe.strings.json");
const MUSIC_CALL = /^(LoadMusic|UnloadMusic|PlayMusic|SetMusicParam)$/;
const problems = [];

const source = readFileSync(PROBE, "utf8");
const strings = JSON.parse(readFileSync(STRINGS, "utf8"));
for (const [name, text] of [["MusicProbe.ts", source], ["MusicProbe.strings.json", JSON.stringify(strings)]]) {
    if (/[^\x00-\x7f]/.test(text)) problems.push(name + " has non-ASCII characters");
}

const s = await replay(source);

function show(a) {
    return typeof a === "number" ? String(a) : String(a);
}
function music(phase) {
    return s.calls.filter((c) => c.phase === phase && MUSIC_CALL.test(c.name)).map((c) => c.name + "(" + c.args.map(show).join(", ") + ")");
}
function waits(phase) {
    return s.calls.filter((c) => c.phase === phase && c.name === "Wait").map((c) => c.args[0]);
}
/** The strings key and args of every on-screen stage notification. */
function stages(phase) {
    return s.calls
        .filter((c) => c.phase === phase && c.name === "DisplayNotificationMessage")
        .map((c) => c.args[0].msg.join(" "));
}
function expect(label, got, want) {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(label + "\n    got:  " + JSON.stringify(got) + "\n    want: " + JSON.stringify(want));
    }
}

const PLAY = "PlayMusic(MusicEvents.Core_LastPhaseBegin)";
const LOAD = "LoadMusic(MusicPackages.Core)";
const URG4 = "SetMusicParam(MusicParams.Core_Urgency, 4)";
const URG0 = "SetMusicParam(MusicParams.Core_Urgency, 0)";

s.setPhase("boot");
s.start();
await s.ticks(5);
expect("boot: CustomConquest verbatim (load, doc amplitude, wait 2, play)", music("boot"), [
    LOAD,
    "SetMusicParam(MusicParams.Core_Amplitude, 1.3)",
    PLAY,
]);
expect("boot: waits", waits("boot"), [2]);
expect("boot: stage shown", stages("boot"), ["probeStage 1"]);
if (!s.logs.some((l) => l.includes("[probe]") && l.includes("Core_LastPhaseBegin"))) {
    problems.push("boot: enum values are not logged");
}

s.setPhase("deploy");
s.deploy();
await s.ticks(5);
expect("deploy: stages 2 to 5", music("deploy"), [PLAY, URG4, URG0, LOAD, PLAY, URG4, URG0]);
expect("deploy: timeline (s)", waits("deploy"), [5, 10, 20, 10, 5, 10, 20]);
expect("deploy: stages shown", stages("deploy"), ["probeStage 2", "probeStage 3", "probeStage 4", "probeStage 5", "probeDone"]);

s.setPhase("redeploy");
s.deploy();
await s.ticks(5);
expect("redeploy: the probe runs once", music("redeploy"), []);

for (const c of s.calls) {
    if (c.name === "DisplayNotificationMessage" && !(c.args[0].msg[0] in strings)) {
        problems.push("strings key missing from MusicProbe.strings.json: " + c.args[0].msg[0]);
    }
}
s.dispose();

if (problems.length > 0) {
    console.error("test-probe: FAIL\n  " + problems.join("\n  "));
    process.exit(1);
}
console.log("test-probe: OK (boot load/amp/play, 5 deploy stages, runs once)");
