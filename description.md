# SFX / VFX Showcase

An in-game asset browser for **Battlefield 6 Portal**. Every sound and visual effect the SDK exposes, searchable and placeable from the portal gadget, with no map and no SDK work. It works in any experience you can add two files to.

- **936** sounds and **312** visual effects, plus 4 player-wide screen effects
- **113** asset groups across the two catalogs
- No Godot, no map, no SDK export. Everything is `mod.SpawnObject` + `mod.PlaySound` / `mod.SetVFXScale`.

---

## Install

You need **two** files:

- `dist/bundle.ts` — the mod
- `dist/bundle.strings.json` — the string table, **1899 keys**

Add both to your experience in the Portal editor at **portal.battlefield.com**.

**The strings file is not optional.** Battlefield Portal does not print the text you hand it — `mod.Message()` takes a *key* and looks it up in the experience's `strings.json`. Upload the script on its own and every label in the panel renders as `<unknown string>`. This is the single most common way to get this mod looking broken when it is working perfectly.

---

## The only control you need

The **portal gadget**, which is granted to you automatically on every deployment.

| Input | What happens |
|---|---|
| **Aim** (right mouse) | Opens the menu |
| **Fire** (left mouse) | Spawns the armed asset where you're looking, then closes the menu |
| **SELECT** in the header | Arms your pick and closes the menu |
| **CLOSE X** | Closes the menu without arming anything |

Fire casts a ray 100 m from your eyes and places the asset on whatever it hits. If you fire with nothing armed you get an "arm something first" hint rather than a stray sound.

With the menu closed, **nothing belonging to this mod is on screen** and the cursor is released back to the game. There is no permanent HUD and no always-on panel.

To change your mind about a placement, aim again to reopen, adjust, and fire again.

---

## The menu

Five tabs across the top. The one you're on stays lit, so you always know where you are.

**SOUND** — 936 `SFX_` members, in 61 groups.
**VISUAL** — 312 `FX_` / `VFX_` members plus the 4 player-wide effects, in 52 groups.
**FAVOURITES** — your own shortlist, described below.
**MUSIC** — every Core, BR and Gauntlet music event and parameter, described below.
**RADIO** — the Radio music package: play, stop, next track, clear queue and its five params.

A compact panel rather than a fullscreen takeover: 1640x800, centred with a margin all round, 8 rows per page, and a group rail down the left.

### Reading a row

Every row is the same shape:

| Column | What it does |
|---|---|
| `+` | Adds the asset to your shortlist. It becomes `*` when saved. |
| `PLAY` | Auditions the asset right now, without arming it |
| `STOP` | Silences that audition |
| **NAME** | The asset name |
| **GROUP** | Which group it came from |
| `SELECT` | Arms it. One click — the menu stays open so you can keep browsing. |
| chips | At-a-glance attributes — `3D`/`2D`, `LOOP`/`ONE`, `WORLD`/`PLAYER`. A one-shot shows its length, e.g. `ONE 1.2s` |

**PLAY never arms anything.** You can audition twenty sounds while deciding, and what fire spawns is still whatever you last selected. Starting a new audition stops the previous one, so you never get eight copies of the same sound stacked on top of each other.

For player-wide effects (gas mask, night vision, saturated, stealth) the PLAY button toggles them on and off immediately instead.

### The group rail

Down the left: `ALL`, then the groups for the current tab, paged 18 rows at a time with `< GROUPS` / `GROUPS >` buttons. 61 groups of sounds and 52 of effects both fit comfortably across four pages.

`ALL` is a button too: it clears the group you picked and shows everything again.

A few group and asset names are spelled differently on screen because the game masks those words with `#`: the `MF` group shows as `MuzzleFlash`, `MF` in a name as `MFX`, and `Smoke` as `SmokeFX`. The asset names you export are unchanged.

The rail header shows live counts, like `202 / 936 MATCH`, so you can see a search narrow the list before you commit to it.

---

## Search and filters

**SEARCH** opens a simulated QWERTY keyboard built from real buttons — Portal has no keyboard or text-input API at all, so this is 45 keycaps plus `SPACE`, `BACK`, `CLEAR` and `DONE`.

- Matches are case-insensitive and hit **both** the readable name and the raw enum name, so `oneshot` finds things you'd never type by hand
- Searching **bypasses the group rail**, so "explosion" finds it in every group at once
- 24 character cap
- `DONE` closes the keyboard, `CLEAR` empties the query, `BACK` deletes one character

**PREFIXES** (bottom-left of the keyboard) flips to page 2: a grid of clickable prefix tokens — `UI`, `Soldier`, `Levels`, `Gadgets`, `Destruction`, `GameModes`, `Projectiles` for sounds, and 52 tokens for effects. Most assets start with one of these, and typing `SFX_UI_` with a mouse is miserable. Click a token, it drops into the query, and the keyboard flips back to QWERTY so you can finish the word.

The list is built from the catalog at build time, never hand-maintained, sorted by how many assets each token covers, and case-duplicates are collapsed (the SDK ships both `SFX_GameModes_` and `SFX_Gamemodes_`, which would otherwise be two buttons doing the same thing).

**Filter chips** sit under the header and combine freely:

- SOUND: `ALL` / `3D` / `2D` / `LOOP` / `ONE`
- VISUAL: `ALL` / `WORLD` / `PLAYER`

They hide on the shortlist tab, because they describe a catalog row's attributes and a shortlist mixes both kinds.

---

## Favourites

Hit `+` on any row to save it. The `FAVOURITES` tab is that list.

- Sounds and effects together, each row badged `SFX` or `VFX` instead of its normal attribute chips
- Kept in the order you added them
- Searchable with the same keyboard, filters the shortlist exactly as it filters the catalogs
- No group rail — there's nothing to group in a shortlist
- Per player, and cleared when you leave

While the FAVOURITES tab is open, the header's SELECT button becomes **EXPORT FAVOURITES**. There's nothing to confirm on a shortlist, so the button that arms everywhere else exports here. It writes to the log, one line per asset:

```
---- FAVOURITES (4) ----
SFX_Alarm | Alarm | SFX | LOOP
SFX_Destruction_Buildings_HouseCollapse_OneShot3D | Destruction_Buildings | SFX | 13.6s
FX_Airburst_Incendiary_Detonation | Airburst | VFX
FX_Vehicle_Wreck_PTV | Vehicle | VFX
---- END FAVOURITES ----
```

Format is **index-file name | group | type**. The name is the enum member on purpose — that's what you paste into the editor. The display name ("Alarm") is useless for looking an asset up, so it is not used.

**Music and radio templates.** On the MUSIC or RADIO tab, `SAVE TEMPLATE` saves the setup on screen to FAVOURITES:
- MUSIC: the package, track, every parameter and the volume;
- RADIO: the station settings, the volume and the tracks you queued since the last `CLEAR QUEUE`.

Saving the same setup twice keeps one copy. In FAVOURITES, a template row shows the track or station and its number:
- `OPEN` puts it back into the tester;
- `PLAY` loads the package if needed and plays it (a radio template re-queues its tracks first);
- `STOP` stops it;
- `*` removes it.

`EXPORT FAVOURITES` writes each template as one plain line of names and values. Templates last for the match, like the rest of your favourites.

**QR CODE.** Console players can't open the log, so FAVOURITES also has a **QR CODE** button. It covers the browser with a QR code of your list; scan it with your phone camera and it opens the [SFX/VFX Decoder](https://kurtinthe-grind.github.io/SfxVfxShowcase/), which shows the same list EXPORT writes: every asset name, then every template line. There you can copy it, download it as JSON or CSV, or copy a link to it.

- The code holds short IDs, not names: `0XG` stands for `FX_ArtilleryStrike_Explosion_01`. About 210 assets fit in one code.
- A longer list is split into parts, `QR 1 / 3` and so on. Page with `<` and `>` and scan each part; the site remembers the parts you scanned and joins them.
- The code takes a few seconds to draw. If your phone does not pick it up, move closer or turn up the screen brightness. The site can also read a photo or screenshot of the code (**Upload QR image**).
- `CLOSE QR` goes back to the list. Closing the menu closes the code too.
- An ID never changes meaning, so a code you saved months ago still reads the same. The IDs are public labels, not encryption.

With DEBUG on, QR CODE also logs each favourite's ID (`QR MAP <name> -> <ID>`) and the exact text in each code (`QR TEXT 1/1: ...`). The format, the ID registry and how to maintain it are in [docs/QR-MAPPING.md](docs/QR-MAPPING.md).

---

## Parameters

The footer carries live parameters for the current tab.

**SOUND** — `AMPLITUDE` 0.10 to 1.00 in steps of 0.1 (default 0.80), and `RANGE` 10 to 120 m in steps of 10 (default 40). Both are applied at placement time via `mod.PlaySound`.

**VISUAL** — `SCALE` 0.25x to 4.00x in steps of 0.1 (default 1.00), applied via `mod.SetVFXScale` on spawn. It applies to the next effect you place, not to ones already down.

---

## Cleaning up

Three buttons in the footer:

- **STOP ALL** — silences every sound this mod is playing. It leaves your placed effects alone.
- **UNDO** — removes the most recent effect you placed.
- **DELETE ALL** — removes every effect you placed and switches all player-wide effects off.

Placed effects are capped at **24 per player**; past that the oldest is removed automatically, so you cannot lock up your own experience by spamming fire.

---

Buttons click with the game's own menu sounds, played only to you. The PLAY buttons stay silent so the click never covers the sound you are testing.

## Debug logging

**DEBUG ON / DEBUG OFF** sits in the header next to the title. It is **off by default** — a debug log is something you switch on to diagnose a problem, not something that runs forever.

With it on, every button press logs its full action and the state it acted on:

```
button: r3_play | open=1 tab=sfx group=-1 page=0 query=kbPage=0 search=0 selected=... armed=...
```

That is what makes *"I clicked it and nothing happened"* diagnosable. If the line is missing, the click never reached the mod. If it is there, the state on it shows what the mod decided. If a button is genuinely misrouted you'll see an `UNHANDLED ACTION` line naming it.

**If something doesn't work, turn DEBUG on, reproduce it, and paste the log.** That is the fastest possible route to a fix.

---

## Known limits

Worth reading so you're not surprised:

- **Highlight is on press, not hover.** Every button goes bright orange (`#FF7A1A`) when you press it and settles when you release. The UI package this mod is built on routes no cursor-over event at all, and Portal's own hover colour is only reachable through a raw API the project rules forbid. Selected *tabs* stay lit permanently, since a tab has to look active after the click.
- **Two known crashers are removed from the catalog.** `SFX_Levels_Brooklyn_Spots_EmergencyExit_SimpleLoop3D` and `SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_Head_SimpleLoop3D` crash the Portal instance on play, so they are filtered out at build time. The build fails if a banlist entry isn't a real asset name, so the guard can't silently rot.
- **The `F` keycap may render as a censor glyph.** Portal censors a standalone "f" used as a single-character token. If you see it, that's the engine's filter, not a missing label. There's a documented one-line fix in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
- **The SCALE range is a best guess.** 0.25x to 4.0x is what the SDK appears to accept; if an effect vanishes at the top of the range, the usable band is narrower and I'll tune it.
- **Sound lengths are measured from recordings.** The SDK exposes no duration for a sound. One-shot lengths come from [tabbedscamper's BF6 Portal SoundBoard](https://github.com/TabbedScamper/BF6_Portal_SoundBoard), which recorded every sound in game. A one-shot plays for its recorded length plus a second. 14 recordings filled their whole recording slot, so those show as `10s+` or `17s+` and get five extra seconds. Four one-shots have no usable recording and keep the old 2.5 s. Loops stop after 8 s. Each player can have 16 sounds playing at once; past that, the oldest stops.

---

## Scaling and caveats

- **Player-wide effects can outlive you.** A soldier effect like the gas mask may survive death, and `DELETE ALL` only switches off your own. Leaving the experience clears yours.
- **No custom textures.** Portal's UI system can't upload an image, so the panel is built from solid fills and outlines. No rounded corners, no icons, no waveforms.
- **Four players using the keyboard at once is the number to watch.** The UI package caps at 2048 elements and 512 buttons; the search keyboard is the heaviest view at roughly 143 buttons per player. Fine below four; above that a team-shared UI would be the right call.

---

## How it works, briefly

For anyone who wants to read the source or extend it.

- **`src/scene.json`** is the single source of geometry and palette. The mod and the browser preview both render it, so they can't drift. Edit the JSON, run `npm run gen`, both move together.
- **The catalog** is generated from the SDK's own `RuntimeSpawn_*` enums, so every asset is a real symbolic member — never a numeric literal. A banned asset is simply absent, so no code path can name it.
- **The UI is `bf6-portal-utils/ui`**, which owns widget creation, naming, input-mode reference counting and click dispatch. The mod never calls `mod.AddUI*`, `mod.SetUI*` or `mod.EnableUIInputMode` directly; a build gate fails if it tries.
- **One click path.** Every button is a `UITextButton` with an `onClickUp` closure that emits an action string. A gate asserts that every action the UI can emit is handled and that the handler doesn't test anything the UI can't emit — the two halves of that contract have both been broken in this project's history, so both directions are now checked.
- **The build has real gates**, and each one is proven by injecting its own bug and expecting a failure. A gate nobody has seen fail isn't a gate.
- **Strings are a contract.** `mod.Message()` arguments must themselves be keys, and Portal's UI font has no arbitrary UTF-8 — an em dash renders as `*`. The build fails on a non-ASCII literal anywhere in the source.

```
npm install
npm run build        # generate -> typecheck -> bundle -> verify
npm run preview      # browser mock at localhost:8081
```

The browser preview is a geometry mock only. It answers "does this layout fit" and nothing else — it has no Portal widget layer, so it cannot tell you whether a button works. That's what the gates and a playtest are for.

---

Feedback and bug reports welcome. **Turn DEBUG on, reproduce the problem, paste the log** — that gets a fix far faster than a description does.

---

## MUSIC and RADIO

Two tester tabs for Portal's music system.

> **No music on Portal Sandbox.** The game plays no scripted music on the Portal Sandbox map, from this mod or any other. Every other map works. Sounds and effects are unaffected, so test music on any other map.

`FOR: ME` (the default) plays everything for you only, so testing never blares music at the rest of the lobby. `FOR: EVERYONE` uses the global calls instead.

Only Core is loaded when the mode starts. There is no LOAD button: `PLAY` loads the package on screen when another one is loaded (and on RADIO, so do `QUEUE TRACK` and `CLEAR QUEUE`). Only one package is loaded at a time. Loading takes about 5 seconds; the track line says `LOADING...`, and anything you press meanwhile is sent once loading is done. `STOP` on a package that is not loaded does nothing, because it is not playing.

**MUSIC**
- `<` / `>` picks the package: CORE, BR or GAUNTLET.
- `|<` / `>|` steps through that package's events, and `PLAY` plays the selected one. `STOP` sends the package's own stop event.
- **PARAMS** lists the package's parameters (for example `Core_IsWinning`, `Core_Sector` and `Core_Urgency`), each with `-` / `+`. While the track plays (after `PLAY`, until `STOP`) a change is sent at once. Otherwise it only changes the panel: some params start music by themselves (`Core_Urgency` above 0 starts tension music), and music should only start on `PLAY`.
- **VOLUME** is the package's amplitude.
- `PLAY` re-sends every param and the volume before the event, so what you hear always matches the numbers on screen.

**RADIO**
- The radio queue starts empty, and `PLAY` on an empty queue plays nothing. Pick a channel, choose a track number, press `QUEUE TRACK`, then `PLAY`.
- `CLEAR QUEUE`, `PLAY`, `STOP` and `NEXT TRACK` send the four `Radio_*` events.
- The track number only goes up to the selected station's last track (the line under PARAMS shows the range, for example `TRACKS 0 to 9` for BF Themes). Channel 4 plays by biome, and the biome sets the range. Changing the station brings the number back inside its range.
- `QUEUE TRACK` sends the channel and biome, then the track number, so the track always comes from the station on screen.
- After `QUEUE TRACK` the track number moves on by one, so pressing it again queues the next song. Under RADIO STATION the panel shows how many tracks you have queued since the last `CLEAR QUEUE`, and the last one added.
- The channel only applies to tracks queued after you set it. To switch stations, press `CLEAR QUEUE`, set the channel, then queue new tracks. The panel says so if the channel changes while tracks are queued.
- **PARAMS** covers channel, biome, queue track number, loop queue, and continue on track end. Biome only matters on channel 4.

**LAST CALL** shows the exact call that was sent last, for example `PlayMusic(Core_PhaseEnded)`. The game cannot report what is actually playing or a param's real value, so the panel shows what was sent.

Every track and parameter has a one-line description on the panel: the selected track's under the transport buttons, and each parameter's under its row. VOLUME and the bottom buttons have one too. The wording and the parameter ranges come from the SDK's Music System docs.

