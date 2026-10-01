// Behaviour test for the MUSIC / RADIO tester tabs.
//
// Replays dist/bundle.ts, clicks through both tabs and asserts the exact music
// calls that reach the engine. The engine cannot be asked what is playing, so
// the calls ARE the behaviour:
//
//   - only Core is loaded at start, and LOAD switches packages exclusively
//     (official modes load exactly one package; loading all four at once
//     played nothing in game on 2026-10-01);
//   - PlayMusic / SetMusicParam target the clicking player, or everyone when
//     the target toggle says so (the global overloads);
//   - every music call is written to the log, so a silent run is diagnosable;
//   - PLAY re-sends the package's params and volume, then the event;
//   - steppers send immediately and clamp to the range;
//   - STOP sends the package's own stop event;
//   - the radio transport maps to the four Radio_* events, and the queue param
//     is only sent by QUEUE TRACK (sending it queues a track);
//   - QUEUE TRACK then moves the number on, wrapping at the station's last
//     track, and the panel shows what was queued since the last CLEAR QUEUE,
//     with a hint when the selected station is not the queued one;
//   - the selected track and every visible param show their description;
//   - PLAY / STOP (and the radio's queue buttons) send nothing while their
//     package is not loaded: a notification says to LOAD it;
//   - buttons click with the game's own menu sounds, played to the clicking
//     player only, except PLAY, which must not cover what is being tested.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, replay } from "./ui-replay.mjs";

const bundle = readFileSync(resolve(ROOT, "dist", "bundle.ts"), "utf8");
const s = await replay(bundle);
const MUSIC_CALL = /^(LoadMusic|UnloadMusic|PlayMusic|SetMusicParam)$/;
const problems = [];

/** Music calls in a phase, as readable strings. Numbers keep 2 decimals. */
function music(phase) {
    return s.calls
        .filter((c) => c.phase === phase && MUSIC_CALL.test(c.name))
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
/** Lets real time pass (utils timers run on Date.now()). */
async function wait(phase, ms) {
    s.setPhase(phase);
    await s.ticks(Math.ceil(ms / 16));
}
// CONFIG.musicLoadMs: the SDK docs say to "allow a few seconds of time for the
// music to load in"; calls for a package still loading are held until then.
const LOAD_MS = 5000;

// On-screen descriptions. Every track and param has one, written by
// tools/gen-music.mjs from the SDK's Music System docs; the panel shows the
// selected track's under the transport and each param's under its row.
const MUSIC_GEN = readFileSync(resolve(ROOT, "src", "music.gen.ts"), "utf8");
const TEXT_GEN = readFileSync(resolve(ROOT, "src", "text.gen.ts"), "utf8");
/** The description key gen-music gave this event or param. */
function descOf(name) {
    const m = new RegExp(`name: "${name}",[^}]*desc: "(\\w+)"`).exec(MUSIC_GEN);
    if (m === null) throw new Error(`music.gen.ts has no description for ${name}`);
    return m[1];
}
/** The strings key of a curated label in text.gen.ts (T.<field>). */
function labelKey(field) {
    const m = new RegExp(`\\b${field}: "(\\w+)"`).exec(TEXT_GEN);
    if (m === null) throw new Error(`text.gen.ts has no label ${field}`);
    return m[1];
}
/** Checks the text node `id` shows `want()` (a key), recording any mismatch. */
function shows(phase, id, want) {
    try {
        const w = want();
        const got = s.textId(id);
        if (got !== w) problems.push(`${phase}: ${id} shows ${got}, expected ${w}`);
    } catch (e) {
        problems.push(`${phase}: ${id}: ${e.message}`);
    }
}
/** Checks the text node `id` shows exactly this Message: [key, ...args]. */
function showsMsg(phase, id, want) {
    try {
        const w = JSON.stringify(want());
        const got = JSON.stringify(s.messageId(id));
        if (got !== w) problems.push(`${phase}: ${id} shows ${got}, expected ${w}`);
    } catch (e) {
        problems.push(`${phase}: ${id}: ${e.message}`);
    }
}
function showsParams(phase, names) {
    names.forEach((n, i) => shows(phase, "mtP" + i + "Desc", () => descOf(n)));
}
/** UI sounds spawned in a phase, short names (SFX_UI_ and _OneShot2D dropped). */
function uiSounds(phase) {
    return s.calls
        .filter((c) => c.phase === phase && c.name === "SpawnObject" && /^RuntimeSpawn_Common\.SFX_UI_/.test(String(c.args[0])))
        .map((c) => String(c.args[0]).replace("RuntimeSpawn_Common.SFX_UI_", "").replace(/_OneShot2D$|_2D$/, ""));
}
function expectSounds(phase, want) {
    const got = uiSounds(phase);
    if (got.join() !== want.join()) problems.push(`${phase}: UI sounds ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    // Every UI sound goes to the clicking player only.
    for (const c of s.calls) {
        if (c.phase === phase && c.name === "PlaySound" && !c.args.some((a) => a && a.kind === "player")) {
            problems.push(`${phase}: a UI sound played to everyone`);
            break;
        }
    }
}
/** The notification keys shown in a phase. */
function notified(phase) {
    return s.calls.filter((c) => c.phase === phase && c.name === "DisplayNotificationMessage").map((c) => c.args[0]?.msg?.[0]);
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
    // The SDK doc's OnGameModeStarted example, call for call: load, then volume.
    expect("boot", ["LoadMusic(MusicPackages.Core)", "SetMusicParam(MusicParams.Core_Amplitude, 1)"]);

    // Deploying plays nothing, even once Core has loaded. A first-deploy smoke
    // test used to play Core_LastPhaseBegin to everyone; it found that Portal
    // Sandbox plays no scripted music (2026-10-01), and on any other map it would
    // only blare music at every player. Music plays only when someone presses PLAY.
    await step("deploy", () => s.deploy());
    expect("deploy", []);
    await wait("after load", LOAD_MS + 600);
    expect("after load", []);
    await step("open", () => s.aim());
    expectSounds("open", ["Submenu_Open"]);
    await step("tab music", () => s.click("MUSIC"));
    expect("tab music", []);
    expectSounds("tab music", ["EOR_NavigationTab"]);
    // The browser body is hidden on the tester tabs: its pager must not be clickable.
    let pagerHidden = false;
    try {
        s.clickId("btnPrev");
    } catch {
        pagerHidden = true;
    }
    if (!pagerHidden) problems.push("tab music: the browser's < PREV button is still visible behind the tester");
    shows("tab music", "mtEventDesc", () => descOf("Core_LastPhaseBegin"));
    showsParams("tab music", ["Core_IsWinning", "Core_PhaseUrgency", "Core_Sector", "Core_Urgency"]);

    // Core starts on Core_LastPhaseBegin (a loud one-shot), so >| is Overtime.
    await step("next", () => s.clickId("mtNext"));
    expect("next", []);
    expectSounds("next", ["MenuNavigation_Default_PrimarySelect"]);
    shows("next", "mtEventDesc", () => descOf("Core_Overtime_Loop"));

    const coreParams = [
        "SetMusicParam(MusicParams.Core_IsWinning, 0, player)",
        "SetMusicParam(MusicParams.Core_PhaseUrgency, 0, player)",
        "SetMusicParam(MusicParams.Core_Sector, 0, player)",
        "SetMusicParam(MusicParams.Core_Urgency, 0, player)",
        "SetMusicParam(MusicParams.Core_Amplitude, 1, player)",
    ];
    await step("play", () => s.clickId("mtPlay"));
    expect("play", [...coreParams, "PlayMusic(MusicEvents.Core_Overtime_Loop, player)"]);
    expectSounds("play", []);

    await step("param up", () => s.clickId("mtP0Up"));
    expect("param up", ["SetMusicParam(MusicParams.Core_IsWinning, 1, player)"]);
    expectSounds("param up", ["MenuNavigation_Default_SlidersClickDown"]);
    // IsWinning is 0..1: a second + clamps and re-sends the clamped value.
    await step("param up again", () => s.clickId("mtP0Up"));
    expect("param up again", ["SetMusicParam(MusicParams.Core_IsWinning, 1, player)"]);

    await step("stop", () => s.clickId("mtStop"));
    expect("stop", ["PlayMusic(MusicEvents.Core_Stop, player)"]);

    await step("volume up", () => s.clickId("mtVolUp"));
    expect("volume up", ["SetMusicParam(MusicParams.Core_Amplitude, 1.1, player)"]);

    // EVERYONE: the same PLAY through the global overloads.
    await step("target all", () => s.clickId("mtTarget"));
    expect("target all", []);
    await step("play all", () => s.clickId("mtPlay"));
    expect("play all", [
        "SetMusicParam(MusicParams.Core_IsWinning, 1)",
        "SetMusicParam(MusicParams.Core_PhaseUrgency, 0)",
        "SetMusicParam(MusicParams.Core_Sector, 0)",
        "SetMusicParam(MusicParams.Core_Urgency, 0)",
        "SetMusicParam(MusicParams.Core_Amplitude, 1.1)",
        "PlayMusic(MusicEvents.Core_Overtime_Loop)",
    ]);
    await step("target me", () => s.clickId("mtTarget"));

    await step("package next", () => s.clickId("mtPkgNext"));
    expect("package next", []);
    shows("package next", "mtEventDesc", () => descOf("BR_InsertionJump"));
    showsParams("package next", ["BRGauntlet_LobbyTimerRemaining"]);
    // BR is on screen but Core is loaded: PLAY and STOP are greyed out and send
    // nothing; a notification says to load BR.
    await step("play br unloaded", () => s.clickId("mtPlay"));
    expect("play br unloaded", []);
    expectSounds("play br unloaded", ["MenuNavigation_WeaponAttachment_NoPoints"]);
    if (notified("play br unloaded").join() !== labelKey("mtLoadFirst")) problems.push(`play br unloaded: notifications ${JSON.stringify(notified("play br unloaded"))}, expected one mtLoadFirst`);
    await step("stop br unloaded", () => s.clickId("mtStop"));
    expect("stop br unloaded", []);
    if (notified("stop br unloaded").length !== 1) problems.push("stop br unloaded: expected one notification");
    await step("load br", () => s.clickId("mtLoad"));
    expect("load br", ["UnloadMusic(MusicPackages.Core)", "LoadMusic(MusicPackages.BR)"]);
    // LOAD on a package that is already loaded must not reload it.
    await step("load br again", () => s.clickId("mtLoad"));
    expect("load br again", []);
    // PLAY while BR is still loading is held, then sent once it has had time.
    await step("play br early", () => s.clickId("mtPlay"));
    expect("play br early", []);
    await wait("play br", LOAD_MS + 600);
    expect("play br", [
        "SetMusicParam(MusicParams.BRGauntlet_LobbyTimerRemaining, 10, player)",
        "SetMusicParam(MusicParams.BR_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.BR_InsertionJump, player)",
    ]);

    await step("tab radio", () => s.click("RADIO"));
    expect("tab radio", []);
    // Radio has no track list: the line under the transport explains the buttons.
    shows("tab radio", "mtEventDesc", () => labelKey("mtRadioHelp"));
    showsParams("tab radio", ["Radio_Biome", "Radio_Channel", "Radio_ContinueQueueOnTrackEnd", "Radio_LoopQueuedTracks", "Radio_QueueTrackNumber"]);
    // The engine cannot be asked what is queued, so the panel counts it.
    shows("tab radio", "mtEventIdx", () => labelKey("mtQueueEmpty"));
    // Radio is not loaded yet: the queue buttons send nothing either.
    await step("queue radio unloaded", () => s.clickId("mtQueue"));
    expect("queue radio unloaded", []);
    if (notified("queue radio unloaded").length !== 1) problems.push("queue radio unloaded: expected one notification");
    await step("next radio unloaded", () => s.clickId("mtNext"));
    expect("next radio unloaded", []);
    await step("load radio", () => s.clickId("mtLoad"));
    expect("load radio", ["UnloadMusic(MusicPackages.BR)", "LoadMusic(MusicPackages.Radio)"]);
    // Radio_QueueTrackNumber is row 4. Stepping it must NOT send: sending queues.
    await step("queue number up", () => s.clickId("mtP4Up"));
    expect("queue number up", []);
    await step("queue", () => s.clickId("mtQueue"));
    expect("queue", []);
    await step("radio play early", () => s.clickId("mtPlay"));
    expect("radio play early", []);
    // Both held calls go out in click order once Radio has loaded.
    await wait("radio play", LOAD_MS + 600);
    expect("radio play", [
        "SetMusicParam(MusicParams.Radio_QueueTrackNumber, 1, player)",
        "SetMusicParam(MusicParams.Radio_Biome, 0, player)",
        "SetMusicParam(MusicParams.Radio_Channel, 2, player)",
        "SetMusicParam(MusicParams.Radio_ContinueQueueOnTrackEnd, 1, player)",
        "SetMusicParam(MusicParams.Radio_LoopQueuedTracks, 1, player)",
        "SetMusicParam(MusicParams.Radio_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.Radio_Play, player)",
    ]);
    // Queued: one track, BF Themes (channel 2) number 1. The number has moved
    // on to 2, so QUEUE TRACK again queues a different song.
    showsMsg("radio play", "mtEventIdx", () => [labelKey("mtQueueCount"), 1, labelKey("radioCh2"), 1]);
    await step("queue again", () => s.clickId("mtQueue"));
    expect("queue again", ["SetMusicParam(MusicParams.Radio_QueueTrackNumber, 2, player)"]);
    showsMsg("queue again", "mtEventIdx", () => [labelKey("mtQueueCount"), 2, labelKey("radioCh2"), 2]);
    await step("radio next", () => s.clickId("mtNext"));
    expect("radio next", ["PlayMusic(MusicEvents.Radio_NextQueuedTrack, player)"]);
    // The channel only applies to tracks queued after it is set (SDK docs:
    // "the channel from which you will be queueing tracks"), so changing it
    // with tracks queued says to clear the queue first.
    await step("channel up", () => s.clickId("mtP1Up"));
    expect("channel up", ["SetMusicParam(MusicParams.Radio_Channel, 3, player)"]);
    shows("channel up", "mtEventDesc", () => labelKey("mtQueueStale"));
    await step("radio clear", () => s.clickId("mtPrev"));
    expect("radio clear", ["PlayMusic(MusicEvents.Radio_ClearQueue, player)"]);
    shows("radio clear", "mtEventIdx", () => labelKey("mtQueueEmpty"));
    shows("radio clear", "mtEventDesc", () => labelKey("mtRadioHelp"));
    // Channel 3 (Reggaeton) has 2 tracks, 0 and 1: after queueing 1 the number
    // wraps to 0.
    await step("queue number down", () => s.clickId("mtP4Down"));
    await step("queue number down", () => s.clickId("mtP4Down"));
    expect("queue number down", []);
    await step("queue last", () => s.clickId("mtQueue"));
    expect("queue last", ["SetMusicParam(MusicParams.Radio_QueueTrackNumber, 1, player)"]);
    await step("queue wraps", () => s.clickId("mtQueue"));
    expect("queue wraps", ["SetMusicParam(MusicParams.Radio_QueueTrackNumber, 0, player)"]);
    showsMsg("queue wraps", "mtEventIdx", () => [labelKey("mtQueueCount"), 2, labelKey("radioCh3"), 0]);
    await step("radio stop", () => s.clickId("mtStop"));
    expect("radio stop", ["PlayMusic(MusicEvents.Radio_Stop, player)"]);

    // Back on a browser tab the tester must be gone and the browser back.
    await step("tab sound", () => s.click("SOUND"));
    await step("close", () => s.click("CLOSE X"));
    expectSounds("close", ["Submenu_Close"]);
    await step("reopen", () => s.aim());
    await step("browser back", () => s.clickId("btnPrev"));
    let testerHidden = false;
    try {
        s.clickId("mtPlay");
    } catch {
        testerHidden = true;
    }
    if (!testerHidden) problems.push("tab sound: the tester's PLAY button is still visible over the browser");

    for (const l of s.logs) if (/UNHANDLED ACTION|error|exception/i.test(l)) problems.push("log: " + l);

    // Every music call must leave a log line: on 2026-10-01 the tester played
    // nothing in game and the log could not say what had been sent.
    const sent = s.calls.filter((c) => MUSIC_CALL.test(c.name)).length;
    const logged = s.logs.filter((l) => /music: (LoadMusic|UnloadMusic|PlayMusic|SetMusicParam)\(/.test(l)).length;
    if (sent !== logged) problems.push(`${sent} music calls were made but ${logged} were logged`);
} finally {
    s.dispose();
}

if (problems.length > 0) {
    console.error("  TESTER BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log("  tester  : Core loaded at start, calls held until loaded, LOAD switches exclusively, ME/EVERYONE overloads, PLAY re-sends params, clamping, stop, radio queue + transport, queue read-out and auto-advance, greyed until loaded, UI sounds, every call logged");
