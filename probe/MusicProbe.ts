// MusicProbe: a control experiment for "no music plays" in SfxVfxShowcase.

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
