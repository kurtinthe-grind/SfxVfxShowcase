# Music and Radio Tester: Implementation Plan

Spec: `docs/superpowers/specs/2026-10-01-music-radio-tester-design.md`.
The owner chose inline execution in one pass ("do all in one shot").

Each task ends with `npm run build` green unless noted. Commits are per task group.

## Task 1: Write the tester test first (red)
- Add `tools/test-tester.mjs`, using `tools/ui-replay.mjs`. The scenario: start, deploy,
  aim, click MUSIC, `>|`, PLAY, `+` on param 0, STOP, VOLUME `+`, then RADIO, PLAY,
  NEXT TRACK.
- It asserts:
  - `LoadMusic` for all 4 packages in the boot phase;
  - every `PlayMusic` and `SetMusicParam` carries the player;
  - PLAY sends the package's params and amplitude before `PlayMusic`;
  - STOP sends `Core_Stop`;
  - RADIO PLAY sends `Radio_Play` after the radio params.
- Run it and see it fail, because there is no MUSIC tab yet.

## Task 2: Music data from Tier 0
- `tools/gen-music.mjs` parses `MusicEvents`, `MusicParams` and `MusicPackages` and
  writes `src/music.gen.ts` and `src/musickeys.json`. The param range table lives here.
- `tools/gen-text.mjs` merges `musickeys.json` and adds the tester labels and templates.
- Add `gen-music` to the `gen` script.

## Task 3: Scene changes
- Re-space the header for 5 tabs and add `tabMusic` / `tabRadio`.
- Add the `browser` group and move the body nodes into it (positions unchanged).
- Add the `tester` group with the four cards (absolute coordinates, origin 0,0), the
  `mtPkgArrows` group, and the `mtP0..4` row groups.

## Task 4: Mod code
- `ui.ts`: `Tab` gains `music` | `radio`. Add the tester fields to `chromeFields`.
  `render()` hides the rail, chips, rows and keyboard on the tester tabs. `buildNodes`
  skips creating hidden nodes that do not exist yet.
- `src/tester.ts`: per-player tester state, fields, and the `mt*` action handler that
  makes the `mod.*` music calls.
- `index.ts`: load the packages in `OnGameModeStarted`, add the tab actions, add the
  `mt` prefix branch, and add tester hints.

## Task 5: Preview
- `gen-sandbox.mjs`: tester fields, plus `music` and `radio` views; hide the browser
  body on them.

## Task 6: Verify and release
- `npm run release`. Run `test-tester` (green) and `check:batching`, which now covers
  MUSIC and RADIO.
- Open the preview (`npm run gen:preview` + `npm run preview`) and screenshot the
  sound, music and radio views.
- Commit.
