// MusicProbe: a control experiment for "no music plays" in SfxVfxShowcase.
//
// Upload this file (with MusicProbe.strings.json) IN PLACE OF SfxVfxShowcase.ts
// in the same experience, deploy, and listen for about 90 s. Each stage shows
// "MUSIC PROBE stage N" top-right and writes a [probe] line to PortalLog.
//
// Every call is copied from the main resources, nothing is invented:
//   - SDK docs, gameplay_logic.html "Music System": LoadMusic(Core) in
//     OnGameModeStarted, then SetMusicParam(Core_Amplitude, 1.3).
//   - CustomConquest V15: LoadMusic(Core); await mod.Wait(2);
//     PlayMusic(Core_LastPhaseBegin).
//   - AcePursuit: load at start, PlayMusic on the first OnPlayerDeployed.
//   - SDK docs: Core_Urgency "functions like a music event ... a looping track",
//     playing while the value is above zero.
//
// Stages:
//   1  start + 2 s    PlayMusic(Core_LastPhaseBegin)   (CustomConquest verbatim)
//   2  deploy + 5 s   PlayMusic(Core_LastPhaseBegin)   (AcePursuit pattern)
//   3  deploy + 15 s  Core_Urgency 4 for 20 s           (long loop, hard to miss)
//   4  deploy + 45 s  LoadMusic(Core) again, 5 s later PlayMusic(Core_LastPhaseBegin)
//   5  deploy + 60 s  Core_Urgency 4 for 20 s, after that second load
// Heard at 1 or 2: the base mode plays music, so SfxVfxShowcase is the cause.
// Heard only at 4 or 5: a load sent at start is lost when the player deploys
// at once. Silent throughout: the base mode is the cause.

let probeRan = false;

function note(line: string): void {
    console.log("[probe] " + line);
}

function stage(n: number, line: string): void {
    note("stage " + n + ": " + line);
    mod.DisplayNotificationMessage(mod.Message("probeStage", n));
}

function describe(label: string, value: unknown): string {
    try {
        return label + "=" + typeof value + ":" + String(value);
    } catch (e) {
        return label + "=" + typeof value + ":<unprintable>";
    }
}

export async function OnGameModeStarted() {
    note("game mode started");
    note(describe("MusicPackages.Core", mod.MusicPackages.Core));
    note(describe("MusicEvents.Core_LastPhaseBegin", mod.MusicEvents.Core_LastPhaseBegin));
    note(describe("MusicParams.Core_Amplitude", mod.MusicParams.Core_Amplitude));
    note(describe("MusicParams.Core_Urgency", mod.MusicParams.Core_Urgency));

    mod.LoadMusic(mod.MusicPackages.Core);
    mod.SetMusicParam(mod.MusicParams.Core_Amplitude, 1.3);
    note("LoadMusic(Core), SetMusicParam(Core_Amplitude, 1.3)");
    await mod.Wait(2);
    mod.PlayMusic(mod.MusicEvents.Core_LastPhaseBegin);
    stage(1, "PlayMusic(Core_LastPhaseBegin) 2 s after LoadMusic");
}

export async function OnPlayerDeployed(player: mod.Player) {
    note("player deployed: " + mod.GetObjId(player));
    if (probeRan) return;
    probeRan = true;

    await mod.Wait(5);
    mod.PlayMusic(mod.MusicEvents.Core_LastPhaseBegin);
    stage(2, "PlayMusic(Core_LastPhaseBegin) 5 s after deploy");

    await mod.Wait(10);
    mod.SetMusicParam(mod.MusicParams.Core_Urgency, 4);
    stage(3, "SetMusicParam(Core_Urgency, 4) for 20 s");
    await mod.Wait(20);
    mod.SetMusicParam(mod.MusicParams.Core_Urgency, 0);
    note("SetMusicParam(Core_Urgency, 0)");

    await mod.Wait(10);
    mod.LoadMusic(mod.MusicPackages.Core);
    note("LoadMusic(Core) again, after deploy");
    await mod.Wait(5);
    mod.PlayMusic(mod.MusicEvents.Core_LastPhaseBegin);
    stage(4, "PlayMusic(Core_LastPhaseBegin) 5 s after the second LoadMusic");

    await mod.Wait(10);
    mod.SetMusicParam(mod.MusicParams.Core_Urgency, 4);
    stage(5, "SetMusicParam(Core_Urgency, 4) for 20 s, after the second LoadMusic");
    await mod.Wait(20);
    mod.SetMusicParam(mod.MusicParams.Core_Urgency, 0);
    note("SetMusicParam(Core_Urgency, 0)");

    note("done");
    mod.DisplayNotificationMessage(mod.Message("probeDone"));
}
