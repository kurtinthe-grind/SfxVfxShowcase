**[Portal] Scripted music (LoadMusic / PlayMusic) is silent on the Portal Sandbox map**

**Describe the Issue Clearly**
**What happened:** On the Portal Sandbox map, scripted music never plays. `mod.LoadMusic`, `mod.SetMusicParam` and `mod.PlayMusic` all run without script errors, and PortalLog shows a log line written after each call, so every call returned. But no music is heard, not even 24 seconds after the package was loaded.
**Expected:** music plays the same as on every other map. The same script, unchanged, plays music on every other map we tried.
Sound effects from `mod.PlaySound` work normally on Portal Sandbox. Only music is affected.

**Steps to Reproduce**
1. In the Portal web builder, create an experience on the **Portal Sandbox** map.
2. Use this script. It is the pattern from the SDK docs (Music System section) and the CustomConquest template:
```ts
export async function OnGameModeStarted() {
    mod.LoadMusic(mod.MusicPackages.Core);
    mod.SetMusicParam(mod.MusicParams.Core_Amplitude, 1.3);
    await mod.Wait(2);
    mod.PlayMusic(mod.MusicEvents.Core_LastPhaseBegin);
}
```
3. Host the experience and deploy. No music plays.
4. Change only the map to any other map, for example [OTHER MAP], and host again. `Core_LastPhaseBegin` plays about 2 seconds after the game mode starts.

Also silent on Portal Sandbox:
- `PlayMusic` for all players 5 seconds after `LoadMusic`
- `PlayMusic(event, player)` for one player 24 seconds after `LoadMusic`, after setting `Core_Amplitude` to 1

Tested with the Core package. BR, Gauntlet and Radio were not verified separately on Portal Sandbox.

**Screenshots/Videos**
[Attach a video of the Portal Sandbox run: the script runs, no music.]
PortalLog excerpt from the Portal Sandbox run. Each line is logged after its call returned:
```
[UTC 2026-10-01 14:28:22] QuickJS: console.log: <SfxVfxShowcase> music: LoadMusic(Core) at game-mode start
[UTC 2026-10-01 14:28:22] QuickJS: console.log: <SfxVfxShowcase> music: SetMusicParam(Core_Amplitude, 1) for=everyone at game-mode start
[UTC 2026-10-01 14:28:27] QuickJS: console.log: <SfxVfxShowcase> music: PlayMusic(Core_LastPhaseBegin) for=everyone loaded=Core [smoke test on first deploy]
[UTC 2026-10-01 14:28:46] QuickJS: console.log: <SfxVfxShowcase> music: PlayMusic(Core_LastPhaseBegin) for=me loaded=Core
```

**Informations**
- Game version: [GAME VERSION]
- Playtest date: 2026-10-01
- Hosting: local host from the Portal web builder
- Portal SDK: 1.4.3.0
- Map: Portal Sandbox (silent). Every other map we tried plays music.
- Game audio: on, volume at full
- PC specs: [CPU / GPU / RAM / OS]
