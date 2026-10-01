# Music and Radio Tester: Design

Date: 2026-10-01. Status: approved by the owner ("do all in one shot").

## Goal

Add two tabs, **MUSIC** and **RADIO**, to the existing gadget menu. They let a creator
audition every Portal music event and tweak every music parameter in-game, without
writing a script. The owner's reference was a separate "MUSIC TESTER" panel with TRACK
(prev / play / next), PARAMS, URGENCY and VOLUME sections, and a switch to a radio
tester.

## Grounding (Tier 0, `types_original/mod/index.d.ts`)

- `LoadMusic(MusicPackages)`, `UnloadMusic(MusicPackages)`
- `PlayMusic(MusicEvents, player)`, `SetMusicParam(MusicParams, number, player)`
- Packages: `Core`, `BR`, `Gauntlet`, `Radio`
- Radio events: `Radio_Play`, `Radio_Stop`, `Radio_NextQueuedTrack`, `Radio_ClearQueue`
- Radio params: `Radio_Channel`, `Radio_Biome`, `Radio_QueueTrackNumber`,
  `Radio_LoopQueuedTracks`, `Radio_ContinueQueueOnTrackEnd`, `Radio_Amplitude`

The mod-types docs advise loading early (`OnGameModeStarted`), and say any event of
any *loaded* package can be played. Values must be numbers, even for booleans.

## Decisions

1. **All four packages are loaded once, in OnGameModeStarted.** Nothing is unloaded,
   because the docs say official modes never unload.
2. **Calls are per-player.** Every `PlayMusic` / `SetMusicParam` uses the player
   overload, so testing never plays music to a whole lobby.
3. **The music data is generated from Tier 0.** A new `tools/gen-music.mjs` reads the
   three enums from `index.d.ts` and writes `src/music.gen.ts`, plus text keys in
   `src/musickeys.json`. A new SDK enum member shows up after the next `npm run gen`,
   with no hand-kept list.
   - Events and params are grouped by name prefix: `Core_`, `BR_`, `Gauntlet_`,
     `Radio_`.
   - `BRGauntlet_*` is listed under BR. **Unverified**: the SDK does not say which
     package owns it. The grouping only affects the menu, because every package is
     loaded.
   - `*_Stop` events are not in the track list, because STOP sends them.
   - `*_Amplitude` is the VOLUME control, not a param row.
4. **Param ranges are guesses**, in one table in `gen-music.mjs`. The engine cannot be
   queried for them, which the panel says on screen.
5. **The engine state is unreadable**, so the panel shows what was *sent*: the values
   we set and the last call (`PlayMusic(Core_PhaseEnded)`).
6. **PLAY re-sends the package's params and volume, then the event**, so what you hear
   always matches the numbers on screen. A stepper sends its param immediately.
   `|<` and `>|` only select a track; they do not play it.

## UI

One shared tester panel in `scene.json` serves both tabs. Its labels and visibility
come from fields, so the mod and the browser preview render the same nodes.

- **Header:** the tabs are SOUND, VISUAL, FAVOURITES, MUSIC and RADIO. The header was
  re-spaced to fit them. `gen-scene`'s header-overlap check still applies.
- **Browser body:** the rail, filters, list, pager and footer move into a new
  `browser` group, which is hidden on the MUSIC and RADIO tabs.
- **Panel cards:**
  - **TRACK:** package `< >`, event name, `n / N`, and `|< PLAY STOP >|`. On RADIO the
    card is titled RADIO and the four buttons become `CLEAR QUEUE`, `PLAY`, `STOP` and
    `NEXT TRACK`.
  - **PARAMS:** up to 5 rows, each with a label, a value and `-`/`+`.
  - **VOLUME:** `-`, the value, `+`.
  - **LAST CALL:** the last call sent.
- **Hidden nodes are not created** until their group is first shown. Before this, every
  scene node was allocated on the first open, even on a hidden tab. Now the tester
  costs nothing until it is opened, which matters given the 2026-10-01 widget-burst
  crash.

## Actions

Every tester action starts with `mt`. `handle()` claims the family with one prefix
branch (which `check-actions` understands) and delegates to `src/tester.ts`. That
module logs `UNHANDLED ACTION` for anything it does not know.

## Testing

- `npm run build`: every existing check, plus `check:batching`. The batching gate now
  also clicks MUSIC and RADIO and must stay under 100 widgets per pass with an
  identical final UI.
- `tools/test-tester.mjs` is a new replay test. It clicks through the tester and
  asserts the exact `LoadMusic` / `PlayMusic` / `SetMusicParam` calls and arguments:
  per-player, package loaded at start, params re-sent before PLAY, clamped ranges, and
  STOP sending the package's stop event.
- Preview: there are new `music` and `radio` views in `gen-sandbox`.

## Out of scope

Unloading packages, team- or squad-wide playback, saving presets, and the voice-over
(`PlayVO`) API.
