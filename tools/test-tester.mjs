// Behaviour test for the MUSIC / RADIO tester tabs.
//
// Replays dist/bundle.ts, clicks through both tabs and asserts the exact music
// calls that reach the engine. The engine cannot be asked what is playing, so
// the calls ARE the behaviour:
//
//   - all four packages are loaded once, at game-mode start;
//   - every PlayMusic / SetMusicParam targets the clicking player only;
//   - PLAY re-sends the package's params and volume, then the event;
//   - steppers send immediately and clamp to the range;
//   - STOP sends the package's own stop event;
//   - the radio transport maps to the four Radio_* events.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";

const bundle = readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8");
const s = await replay(bundle);
const problems = [];

/** Music calls in a phase, as readable strings. Numbers keep 2 decimals. */
function music(phase) {
    return s.calls
        .filter((c) => c.phase === phase && /^(LoadMusic|UnloadMusic|PlayMusic|SetMusicParam)$/.test(c.name))
        .map((c) =>
            c.name +
            "(" +
            c.args
                .map((a) => (typeof a === "number" ? String(Math.round(a * 100) / 100) : a && a.kind === "player" ? "player" : String(a)))
                .join(", ") +
            ")"
        );
}
function expect(phase, want) {
    const got = music(phase);
    if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
        problems.push(`${phase}:\n        want ${want.join("\n             ")}\n        got  ${got.join("\n             ") || "(nothing)"}`);
    }
}
async function step(phase, fn) {
    s.setPhase(phase);
    try {
        fn();
    } catch (e) {
        problems.push(`${phase}: ${e.message}`);
    }
    await s.ticks(40);
}

try {
    s.start();
    await s.ticks(5);
    expect("boot", [
        "LoadMusic(MusicPackages.Core)",
        "LoadMusic(MusicPackages.BR)",
        "LoadMusic(MusicPackages.Gauntlet)",
        "LoadMusic(MusicPackages.Radio)",
    ]);

    await step("deploy", () => s.deploy());
    await step("open", () => s.aim());
    await step("tab music", () => s.click("MUSIC"));
    expect("tab music", []);
    // The browser body is hidden on the tester tabs: its pager must not be clickable.
    let pagerHidden = false;
    try {
        s.clickId("btnPrev");
    } catch {
        pagerHidden = true;
    }
    if (!pagerHidden) problems.push("tab music: the browser's < PREV button is still visible behind the tester");

    await step("next", () => s.clickId("mtNext"));
    expect("next", []);

    const coreParams = [
        "SetMusicParam(MusicParams.Core_IsWinning, 0, player)",
        "SetMusicParam(MusicParams.Core_PhaseUrgency, 0, player)",
        "SetMusicParam(MusicParams.Core_Sector, 0, player)",
        "SetMusicParam(MusicParams.Core_Urgency, 0, player)",
        "SetMusicParam(MusicParams.Core_Amplitude, 1, player)",
    ];
    await step("play", () => s.clickId("mtPlay"));
    expect("play", [...coreParams, "PlayMusic(MusicEvents.Core_EndOfRound_Loop, player)"]);

    await step("param up", () => s.clickId("mtP0Up"));
    expect("param up", ["SetMusicParam(MusicParams.Core_IsWinning, 1, player)"]);
    // IsWinning is 0..1: a second + clamps and re-sends the clamped value.
    await step("param up again", () => s.clickId("mtP0Up"));
    expect("param up again", ["SetMusicParam(MusicParams.Core_IsWinning, 1, player)"]);

    await step("stop", () => s.clickId("mtStop"));
    expect("stop", ["PlayMusic(MusicEvents.Core_Stop, player)"]);

    await step("volume up", () => s.clickId("mtVolUp"));
    expect("volume up", ["SetMusicParam(MusicParams.Core_Amplitude, 1.1, player)"]);

    await step("package next", () => s.clickId("mtPkgNext"));
    expect("package next", []);
    await step("play br", () => s.clickId("mtPlay"));
    expect("play br", [
        "SetMusicParam(MusicParams.BRGauntlet_LobbyTimerRemaining, 60, player)",
        "SetMusicParam(MusicParams.BR_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.BR_InsertionCinematic_Dropzone_Loop, player)",
    ]);

    await step("tab radio", () => s.click("RADIO"));
    expect("tab radio", []);
    await step("radio play", () => s.clickId("mtPlay"));
    expect("radio play", [
        "SetMusicParam(MusicParams.Radio_Biome, 0, player)",
        "SetMusicParam(MusicParams.Radio_Channel, 0, player)",
        "SetMusicParam(MusicParams.Radio_ContinueQueueOnTrackEnd, 1, player)",
        "SetMusicParam(MusicParams.Radio_LoopQueuedTracks, 0, player)",
        "SetMusicParam(MusicParams.Radio_QueueTrackNumber, 0, player)",
        "SetMusicParam(MusicParams.Radio_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.Radio_Play, player)",
    ]);
    await step("radio next", () => s.clickId("mtNext"));
    expect("radio next", ["PlayMusic(MusicEvents.Radio_NextQueuedTrack, player)"]);
    await step("radio clear", () => s.clickId("mtPrev"));
    expect("radio clear", ["PlayMusic(MusicEvents.Radio_ClearQueue, player)"]);
    await step("radio stop", () => s.clickId("mtStop"));
    expect("radio stop", ["PlayMusic(MusicEvents.Radio_Stop, player)"]);

    // Back on a browser tab the tester must be gone and the browser back.
    await step("tab sound", () => s.click("SOUND"));
    await step("browser back", () => s.clickId("btnPrev"));
    let testerHidden = false;
    try {
        s.clickId("mtPlay");
    } catch {
        testerHidden = true;
    }
    if (!testerHidden) problems.push("tab sound: the tester's PLAY button is still visible over the browser");

    for (const l of s.logs) if (/UNHANDLED ACTION|error|exception/i.test(l)) problems.push("log: " + l);
} finally {
    s.dispose();
}

if (problems.length > 0) {
    console.error("  TESTER BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log("  tester  : packages loaded at start, per-player play/params, PLAY re-sends params, clamping, stop and radio transport all correct");
