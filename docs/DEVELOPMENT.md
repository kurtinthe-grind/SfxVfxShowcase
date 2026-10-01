# Development notes

The history and reasoning behind the code: Portal quirks this project hit, why
each build gate exists, and how the UI is wired. The user guide is the
[README](../README.md) and [description.md](../description.md).

## Diagnostics - console.log

There is **no on-screen debug panel**. Diagnostics go to `console.log`, which
Portal exposes to the PC build, so a run can be reported by pasting the log.

| Piece | Why |
| --- | --- |
| `bf6-portal-utils/logging` | AGENT.md 2.4 / 4.2 require preferring the vetted utils over hand-rolled code. It wraps the sink in try/catch so a logging failure can never crash the mod, and filters by level. |
| `console.log` | The sink. It is a QuickJS global provided by Portal, **not** a `mod.*` API, so it is absent from `index.d.ts`. Used this way by `bf6-portal-utils/logging` itself; `console.error` appears in `modlib_original`. `tsconfig.json` sets `lib: [ES2020, DOM]`, which is what makes it typecheck. |
| `Logging.LogLevel.Debug` | Everything is logged. This is a build being debugged, not a shipped mode. |

Wired up in `OnGameModeStarted`:

```ts
logging.setLogging((text) => console.log(text), Logging.LogLevel.Debug, true);
```

### What gets logged

| Line | When |
| --- | --- |
| `game mode started: N sfx, N vfx, N prefixes, N player-wide, menu starts closed` | once, with the catalog sizes |
| `deploy: player N granted the portal gadget` | every `OnPlayerDeployed` |
| `gadget aim: opening menu, tab=...` | `OnPortalGadgetAimStart` |
| `gadget fire: armed=... tab=... scale=...` | `OnPortalGadgetFireStart` |
| `gadget fire: nothing armed, showing the arm-first hint` | firing with an empty hand |
| `raycast hit: placed <type> <name>, world total=N` | a successful spawn |
| `button: <action> | open=... tab=... group=... page=... query=... kbPage=... search=... selected=... armed=... dim=... kind=... vfx=... amp=... rng=... scale=...` | **every** UI button press, with the full state it acted on |

The `button:` line is what makes *"I clicked it and nothing happened"*
diagnosable: if the line is missing, the click never reached the router; if it
is present, the state on it shows what the router decided.

### AGENT.md section 9

`PortalLog.txt` is user-gated. Nothing in this project reads it. If a diagnosis
needs a log, **paste it in chat** - that pasted content is the evidence.

## Portal font: ASCII only

Portal's UI font has no arbitrary UTF-8, so any glyph outside printable ASCII
renders as `*`. This bit three times: `PREV`/`NEXT` used U+2039/U+203A, CLOSE
used U+2715, the query cursor used U+258C, and `CONFIG.playGlyph` / `spawnGlyph` /
`effectGlyph` used U+25B6 / U+25C6 / U+25C9. The last set lived in `config.ts`,
which the original strings gate could not see - it only checked values inside
`strings.json`.

`tools/check-strings.mjs` now scans every string literal in `src/` and fails the
build on a non-ASCII one. `tools/test-ascii-gate.mjs` injects U+25B6 back into
`config.ts` to prove the gate still fails, because a gate nobody has seen fail is
not a gate. The ACTION column now reads **P** (audition), **S** (spawn),
**T** (toggle).

## Portal text needs a strings table

**This is the first thing to check if the panel renders as `<unknown string>`.**

Battlefield Portal does not print the string you hand it. `mod.Message()` takes a
**key** and looks it up in the experience's `strings.json`; anything it cannot
resolve comes back as `<unknown string>`. Three consequences, all of which bit
during development:

1. **Every visible string needs an entry in `strings.json`.** Titles, tabs, row
   names, group names, filter chips, key caps, hints — all of them. A browser
   preview has no such table, so the preview always looks fine.
2. **Arguments to `mod.Message()` must also be keys.** Numbers are the exception;
   they can be passed raw. So `"ARMED: " + name` does not work — it becomes
   `mod.Message(TPL.armedOf, row.key)`, where `armedOf` is the template
   `"ARMED: {}"` and `row.key` is the asset's own entry.
3. **Portal's UI font has no arbitrary UTF-8.** An em dash, a middot or a block
   cursor renders as `*`. Every value in the table is printable ASCII, and
   `tools/check-strings.mjs` fails the build if it is not.

### Uploading the table

The build writes the merged table to `dist/bundle.strings.json` — currently about
**1720 keys**. `bf6-portal-bundler` merges every `strings.json` in the project
into that one file.

**That file has to be added to the Experience in the Portal editor, or every label
will be `<unknown string>`.** It is not shipped by uploading the script alone.

### How the keys are produced

| File | Role |
| --- | --- |
| `tools/gen-text.mjs` | Owns the text contract. Holds the curated labels and format templates, harvests the literals in `scene.json`, and merges in the catalog's keys. Writes `src/text.gen.ts` and `src/strings.json`. |
| `src/text.gen.ts` | Generated. Exports `T` (curated label keys), `TPL` (templates), `CHAR_KEY` (single characters) and `SCENE_TEXT` (literals read out of `scene.json`). |
| `tools/gen-catalog.mjs` | Mints a stable key per asset, group and prefix, and writes `src/textkeys.json` for the text generator. |
| `tools/check-strings.mjs` | Build gate: every referenced key exists, every value is printable ASCII, and no bare literal reaches `mod.Message()`. |

Because the labels are reached as `T.someName`, a missing one is a **TypeScript
error**, not a blank label in game.

### The search query is the one piece of arbitrary text

A query like `"gadgets tree"` has no single entry, so it is drawn **one character
per widget**, each character using a `CHAR_KEY` entry. That keeps the table bounded
at roughly 40 character keys instead of one per possible query. Portal's font is not
monospaced, so those cells are fixed width and the spacing varies slightly — the
same compromise `bf6-portal-utils`' logger makes.

### Known font caveat

Portal censors a standalone `"f"` or `"F"` used as a single-character token, which
affects the **F** key cap and an `f` typed into the query. If that shows as a censor
glyph, change the `sxC..` entry for that character in `src/strings.json` to `"ff"`
(one extra character on screen) and re-run `npm run build`. Not yet verifiable
without the game.

# SFX / VFX Showcase — Battlefield 6 Portal

A two-tab in-game asset browser driven entirely by the **portal gadget**, which is
granted to the player on every deployment.

| Gadget input | Action |
| --- | --- |
| **Aim** (right mouse) | **Opens the menu** |
| **Fire** (left mouse) | **Spawns the armed asset** at the raycast hit point, then closes the menu |
| **SELECT** in the menu | Arms the highlighted row and closes the menu |
| **☰** button | Fallback toggle for players who cannot aim |

Reopen with **aim** to undo the last placement or delete everything.

| Tab | Contents | Count |
| --- | --- | --- |
| **SOUND (SFX)** | `SFX_*` members of `RuntimeSpawn_Common` | **936** across 61 groups |
| **VISUAL (VFX)** | `FX_*` + `VFX_*` members, plus 4 player-wide effects | **312 + 4** across 52 groups |

No map required. No Godot/SDK work. Everything is `mod.SpawnObject` +
`mod.PlaySound` / `mod.SetVFXScale`.

## Commands

```bash
npm install
npm run build        # gen -> typecheck -> bundle -> verify dist
npm run preview      # http://localhost:8081/
```

| Script | Does |
| --- | --- |
| `npm run gen` | Regenerate `src/catalog.ts` + `src/scene.gen.ts` + `src/text.gen.ts` |
| `npm run gen:preview` | Regenerate `preview/src/sandbox.js` from the same data |
| `npm run typecheck` | `tsc --noEmit` on `src/` against Tier 0 |
| `npm run check:invariants` | Input mode, one click path, no `String(Message)`, visibility cascade |
| `npm run check:fields` | Every text field produces a `Message`; `UITextButton` has a label and a handler |
| `npm run check:actions` | `handle()` covers every action `ui.ts` can emit, and nothing else |
| `npm run probe:keyboard` | The query readout clears the key rows and stays inside the box |
| `npm run strip-comments` | Comment cleanup; add `--write` to apply, omit it to report |
| `npm run check:bundle` | Assertions on the shipped `dist/bundle.ts` |
| `npm run test:gates` | Proves each gate still bites, by injecting its bug and expecting a failure |
| `npm run bundle` | `bf6-portal-bundler` → `dist/bundle.ts` + `dist/bundle.strings.json` |
| `npm run typecheck:dist` | **Delivery gate** — parses/typechecks the real bundle |

`npm run build` runs all of the above in order and stops at the first failure.

`npm run gen` fails the build on a bad banlist name, on an unbracketed generated
array, and on **any layout overflow** (every screen/row/rail node must fit its
box; the 13-row list must fit between the header and the pager).

### Preview views

The preview is a **CSS mock of the scene geometry only**. It cannot show whether a
button works, what `mod.Message` resolves to, or how `bf6-portal-utils/ui`
dispatches a click — there is no Portal widget layer and no `mod.Message` in the
browser at all. It answers exactly one question: does the layout fit, and does the
text land where the scene says it should. Everything else is a gate or a playtest.

`http://localhost:8081/?view=<state>`, or edit `VIEW` in `preview/src/sandbox.js`
and save (hot-reloads):

`sfx` · `vfx` · `snow` · `gas` · `grouped` · `selected` · `armed` · `closed` · `empty` · `search` · `filters` · **`pfxSfx`** · **`pfxVfx`**

Add `?notes=1` for the fidelity-gap notes block. It is **off by default** because it
is dev scaffolding, not part of the HUD, and it sits directly under the panel where
it reads as if it were.

### Headless probe

`node tools/probe-preview.mjs <view>` runs the sandbox against a stubbed DOM and
reports what was actually laid out and where. It catches positioning and visibility
bugs with no browser involved:

```
node tools/probe-preview.mjs snow
view=snow  elements=145
row band (278,116) 842x414: 80 elements
first row name: "Snow BlowingSnow L"
rail band: 21 elements
```

## Using it

## Search and filters

Portal has **no keyboard or text-input API** — the only UI event is
`OnPlayerUIButtonEvent` — so the search field is a simulated QWERTY built from
ordinary UI buttons (44 of them: digits, `QWERTYUIOP`, `ASDFGHJKL-`,
`ZXCVBNM.,_`, plus SPACE / BACK / CLEAR / DONE).

| Control | Behaviour |
| --- | --- |
| **SEARCH** | Opens / closes the keyboard overlay |
| Type on the keyboard | Case-insensitive substring match on both the display name and the raw enum name. **Bypasses the group rail** — searching "explosion" finds it in every group |
| **BACK / CLEAR / DONE** | Delete a character, empty the query, close the keyboard |
| Query cap | 24 characters (`MAX_QUERY` in `src/ui.ts`) |
| **PREFIXES** | Switches the keyboard to page 2: a grid of clickable asset prefixes
| **ALL / 3D / 2D / LOOP / ONE** (SFX) | Attribute filter chips, toggle on/off, combine freely |
| **ALL / WORLD / PLAYER** (VFX) | Same, for world-spawned effects vs player-wide ones |

### Page 2: PREFIXES

Most assets begin with a category token (`SFX_UI_…`, `FX_Gadgets_…`,
`FX_Snow_…`), and typing those out is miserable with a mouse. The keyboard's
second page is a grid of those tokens — click one and it is appended to the
query, then the keyboard flips back to QWERTY so you can finish the word.

| Tab | Prefixes | Top tokens |
| --- | --- | --- |
| SFX | 9 | UI (331), Soldier (200), Levels (136), Gadgets (103), Destruction (68), GameModes (66), Projectiles (31), Alarm (1), VOModule (1) |
| VFX | 52 | Gadget (106), Grenade (31), Impact (27), BASE (15), Missile (10), Vehicle (10), … |

Details:

- The list is **derived from the catalog at build time**, never hand-maintained —
  `prefixOf()` in `tools/gen-catalog.mjs` takes the first `_`-segment after
  `SFX_` / `FX_` / `VFX_`.
- Tokens that differ **only in case** are collapsed, keeping the most common
  spelling. The SDK ships both `SFX_GameModes_…` and `SFX_Gamemodes_…`, which
  would otherwise render as two buttons doing the same thing.
- Sorting is by frequency, so the prefixes covering most assets come first.
- The grid is **8×7 = 56 slots**, sized so all 52 VFX prefixes fit. The build
  fails if the catalog ever produces more prefixes than the grid can show, so a
  prefix can never become unreachable.
- The prefix token is matched as a plain substring, the same as typed text, so it
  also finds assets whose *display* name hides the token.

Live result counts appear in two places: the rail header (`202 / 936 MATCH`) and
the keyboard's own readout. `?view=search` and `?view=filters` in the preview
show both states.

## Control scheme

The portal gadget is the only way in. There is no always-on HUD.

| Input | Result |
| --- | --- |
| **Aim** (right mouse, `OnPortalGadgetAimStart`) | Opens the menu and enables UI input mode |
| **?** on a sound row | Auditions it in place, without arming |
| **SELECT** | Arms the highlighted row, closes the menu, disables input mode |
| **CLOSE X** | Closes the menu without arming |
| **Fire** (left mouse) | Spawns the armed asset at the raycast hit, closes the menu |
| **UNDO** / **DELETE ALL** | Removes the last spawn / everything you placed |

### Why there is no MENU button

There was one, as a fallback for players who cannot aim. It was removed because
it could not work:

1. `mod.EnableUIInputMode` (Tier 0: *"Determines if UI Buttons can be interacted
   with"*) has to be on for a button to be clickable at all.
2. Leaving it on while the menu is closed **locks the player out of the match** -
   the mouse is swallowed and nothing else is playable. That was the first
   in-game report.
3. So input mode now follows the menu's open state, which means a button outside
   the open menu is unclickable. The toggle could close an open menu but never
   reopen one: a dead affordance that looked live.

The full-screen `shell` plate went with it, since it existed to back that button.
With the menu closed, **nothing belonging to this mod is on screen** (`?view=closed`
in the preview renders 0 elements).

`setOpen()` in `index.ts` is the only place `ui.open` changes, so the state and
the input mode cannot drift apart. `tools/check-invariants.mjs` fails the build if
anything else assigns `ui.open`, or if input mode is ever a constant.

| **▶** on a sound row | Auditions it **immediately from the menu** — 2D at you, no gadget needed |
| **◆** on a VFX row | Spawns a preview of that effect 3 m in front of you, at the current scale |
| **◉** on a screen row | Toggles it on/off immediately (VL7 gas, night vision, …) |
| **SELECT** on a row | Highlights it as your working selection |
| **SELECT** in the header | Arms the selection **and closes the menu** |
| **Fire the gadget** | Raycast 100 m → spawn the armed asset at the hit point, then close the menu |
| **Aim the gadget** | Opens the menu |
| **☰** | Fallback menu toggle (aim is the primary way to open it) |
| **UNDO** | Removes the most recently placed VFX |
| **DELETE ALL** | Removes every VFX you placed and switches all screen effects off |
| **SCALE −/+** | VFX only. Drives `mod.SetVFXScale` on spawn, 0.25×–4.0× |
| **AMPLITUDE / RANGE −+** | SFX only. 0.10–1.00 and 10–120 m |
| **Group rail** | `ALL` plus the biggest groups per tab |
| **PREV / NEXT** | Pages the 9-row list |

## Footprint

The HUD is a compact top-left panel, not a fullscreen overlay:

| | |
| --- | --- |
| Panel | **1640 × 800**, centred at (140, 140) — 140 px margin on all four sides |
| Rows | 8 per page, 1316 × 62 each |
| Group rail | 19 rows, 300 px wide |
| Live widgets | ~200 (8 rows × 9 + ~57 chrome + 19 rail) |
| Type scale | row names 18, header 26, buttons 15–18, labels 12–13 |

**One panel background covers every band** — header, rail, list header, rows,
pager, footer and the hint line all sit on `panel`/`shell` fills, so no control
or label ever floats over the game world. `gen-scene.mjs` fails the build if
`panel` is not exactly centred, or if any band escapes the panel rectangle.

`textSize` values are absolute, so they are independent of panel size. Everything
lives in `src/scene.json`; change it, run `npm run gen`, and the mod and preview
both follow.

### The preview renderer needed fixing before any of it was trustworthy

The upstream `bf6-portal-ui-preview` renderer has two bugs that silently
invalidate type and alignment tuning:

1. `UIText` **never applies `params.textSize`** (only `UITextButton` did), so
   every plain-text element rendered at the browser default.
2. `UITextButton` **hardcodes centre alignment**, ignoring `textAnchor`, so
   left-aligned button labels rendered centred.

`tools/gen-sandbox.mjs` re-applies both fixes after every copy, since
`copyPreviewTool()` overwrites the renderer. The markers `TEXT_SIZE_PATCH` and
`TEXT_ANCHOR_PATCH` make the patches idempotent.

Also note the upstream `index.html` opens a long-lived SSE connection, which stops
headless Chrome/Edge from reaching network idle, so `--screenshot` hangs forever.
`gen-sandbox.mjs` re-applies a `?nohot=1` gate for the same reason.


SFX are bounded and cleaned up automatically (spawned → played → stopped →
unspawned). VFX are persistent, so they need the undo/delete controls.

## Where the assets come from

`mod.SFX` and `mod.VFX` are **opaque** (`index.d.ts:105`, `:150`) — you cannot
construct one in script. There are exactly two sources, and this mod uses the
script one:

| Source | Signature | Used? |
| --- | --- | --- |
| Map-placed object | `mod.GetSFX(objId)` / `mod.GetVFX(objId)` | not needed |
| **Runtime spawner** | `mod.SpawnObject(prefabEnum, pos, rot, scale)` | **yes** |

`RuntimeSpawn_Common` (portable, any map) holds **938 `SFX_*`** and **312
`FX_*`/`VFX_*`**. The other 26 `RuntimeSpawn_*` enums hold 222 more `FX_*` but
they are **map-specific** — flip `INCLUDE_MAP_FX` in `tools/gen-catalog.mjs` to
fold them in.

### Snow and VL7 gas

- **Snow — included, works on any map.** All 8 snow effects are in
  `RuntimeSpawn_Common` under the `Snow` group: `FX_Snow_BlowingSnow_{XS,S,M,L}`,
  `FX_Snow_BlowingSnow_S_01_inShadow`, `FX_Snow_DriftingSnow_Rooftop_{S,Bridge}`,
  `FX_Snow_WhiteLeaves`. See `?view=snow`.
- **VL7 gas — included, works on any map**, as a *player-wide* effect rather than
  a world object: `mod.EnableScreenEffect(player, mod.ScreenEffects.VL7, on)` plus
  `mod.SetSoldierEffect(player, mod.SoldierEffects.VL7Effect, on)`. It lives in
  the `Gas` group alongside the real gas. See `?view=gas`.
- **World gas smoke is *not* shipped.** `FX_Sub_Gas_Smoke_{2x2m,2x5m,5x5m}_TerrainSnap`
  and `FX_Sub_GasLeak` exist but only in `RuntimeSpawn_Subsurface`, so they only
  resolve on the Subsurface map. Set `INCLUDE_MAP_FX = true` to add them.

`mod.SetVL7CloudEffects` / `mod.GetVL7Cloud` also exist, but a `VL7Cloud` is a
placed volume entity — that route needs a map and is not used here.

## Control scheme

| Input | Does |
| --- | --- |
| **Aim** (right mouse) | Opens the menu. The only opener. |
| **Fire** (left mouse) | Spawns the armed asset where the raycast lands, then closes the menu. |
| **SELECT** in the menu | Arms the highlighted row, then closes. |
| **CLOSE** in the menu | Closes, leaving the selection alone. |

Firing with nothing armed shows the "arm something first" hint in the world log and
does **not** open the menu. It used to open it as well, which made fire a second
opener: both triggers opened the browser and neither read as "spawn", so a player who
pulled the trigger with nothing armed expected a sound and got the menu instead.
`check-invariants.mjs` now asserts the fire handler never calls
`setOpen(..., true)`, and the self-test re-injects the old behaviour to prove it.

## The query readout is above the keys, and why that took a fix

The readout is one widget per character, because arbitrary typed text has no
`strings.json` key of its own. It sits in its own band at the top of the keyboard
box, above the key rows, on an inset field so it reads as an input rather than
another key.

It was invisible in game. The cause was a coordinate-origin bug, not a layout one:
the key rows are children of the keyboard container and position themselves with
`kb.rowY[r] - kb.y`, while the readout used `kb.queryY` directly. The two used
different origins, so the readout rendered 216px too low — straight on top of the
third key row. `scene.json` was correct the whole time; the arithmetic in `ui.ts`
was not, which is why no layout gate caught it.

`check-invariants.mjs` now asserts the readout offsets by `kb.y` and that the key
rows still do, and `gen-scene.mjs` asserts the band keeps at least 12px of clearance
above the first key. `npm run probe:keyboard` prints the geometry.

The keyboard block was also moved down and resized to its content while this was
fixed, so the readout has 32px of clear space instead of touching the keys:

| | before | after |
| --- | --- | --- |
| box | y=216..756 | y=252..752 |
| readout | y=230..290 | y=272..328 |
| first key row | y=310 | y=360 |
| bottom bar | y=606 | y=656 |
| clearance above keys | 0 (overlapping) | 32px |

### What the preview can and cannot tell you about this

It cannot. The preview is a flat, absolutely-positioned mock with no container
hierarchy, so the readout was always positioned in absolute terms there and always
looked fine. A bug that only exists in the container-relative arithmetic is
invisible to it by construction. The gates above exist because of that gap.

## Saved assets

Every row has a `+` in its leftmost column. Click it to add the asset to a
shortlist; it becomes `*` and the cell turns amber. The **FAVOURITES** tab is that
shortlist.

| | |
| --- | --- |
| Both kinds in one place | SFX and VFX together, each row badged **SFX** or **VFX** in place of its normal attribute badges |
| Order is the shortlist | Kept in the order you added them, exported in that order |
| Searchable | The keyboard filters the shortlist exactly as it filters the catalogs |
| No group rail | Nothing to group in a shortlist; the rail and its pager hide on that tab |
| Filter chips hidden | They describe a catalog row's attributes, and a shortlist mixes both kinds |

**EXPORT FAVOURITES** is the header's button while the FAVOURITES tab is open -- there is
nothing to confirm on a shortlist, so the same button that arms elsewhere exports
here. It writes every saved asset to the log by its **index-file name**:

```
---- FAVOURITES (3) ----
SFX_Alarm | Alarm | SFX
FX_Airburst_Incendiary_Detonation | Airburst | VFX
FX_Vehicle_Wreck_PTV | Vehicle | VFX
---- END FAVOURITES ----
```

One line per asset: **index-file name | group | type**. The name is the enum member
because that is what you paste into the editor -- the display name ("Alarm") is
useless for looking an asset up. The group is the row's GROUP column value, so the
export carries everything needed to find it again. `check-invariants` asserts the
export uses `rowRawName()` and never `rowDisplay()`.

### PLAY and STOP

Every row has **PLAY** and **STOP** beside it.

* **PLAY** auditions without arming, so browsing never changes what fire spawns.
* **STOP** silences that row's audition.
* Starting a new audition stops the previous one, so replaying a row replaces the
  sound instead of stacking another copy on top of it. Eight clicks on PLAY in one
  second used to produce eight simultaneous sounds, which is not a preview of
  anything.

Only the audition is capped. Sounds placed in the world are untouched, and the
footer's **STOP ALL** still silences the lot.

### One list, derived once

Two bugs in this project have had the same shape: the filter chips were keyed by
action and collided across tabs, then the row-click handler rebuilt the visible list
with `listFor()` while the renderer used `favRows()` on the shortlist. Both were
"two places compute the same thing", and the second one meant clicking a saved
asset's `*` addressed an unrelated catalog entry -- so removing a favourite
appended a new one instead.

`visibleList()` is now the only function that derives the list, and both the
renderer and the click handler call it. `check-invariants` asserts the click handler
does not rebuild it, and the self-test re-injects the original bug to prove it.

## Highlighting

Every button brightens to a fixed **orange** (`#FF7A1A`) on press, and its label goes
white.

It used to be the button's own base colour multiplied by 1.35. That is invisible on a
dark button: `#241E36 * 1.35` is still nearly `#241E36`. The keyboard keys and the
prefix tiles are the worst case, because they are dark on dark -- which is why they
registered as "barely visible" rather than as a highlight at all. A fixed saturated
colour does not have that failure mode.

**Why press and not hover:** `bf6-portal-utils/ui` routes no hover event at all --
its own `ui/index.ts:245` logs *"HoverIn and HoverOut button events not supported"* --
and exposes no hover colour. The engine's `hoverColor` exists only in the raw
`mod.AddUIButton` overloads, which `AGENT.md` §5 forbids. So there is no hover to
have through the package, and `onFocusIn` stays wired in case Portal ever maps
cursor-over to focus.

## The gadget's green laser

**Not tracked, and not shown.** The SDK has no setter -- a search of `index.d.ts`
finds no `SetLaser` or `EnableLaser`, and the only input API is `SetAiInput`, which
drives AI players rather than a human's own. So the mod could never turn the laser
on for a player; all it could do was observe the toggle event and report back.

That report was a **LASER ON / LASER OFF** read-out in the header, a world-log line
when it came on, and an extra hint on an unarmed fire. None of it changed what
happens when a player places a sound, so it was read-out for a read-out's sake and
it cost a strip of header that the armed asset name now needs. It has been removed:
no state, no event subscription, no strings, no widget.

## Colours, and what "highlighted" means here

`AGENT.md` §5 forbids `mod.AddUIButton`, so the UI cannot hook a cursor-over event.
There is no hover to have. What it can do is drive the three native button states
the package exposes, and that is what the highlight is built from:

| state | colour | when |
| --- | --- | --- |
| base | the node's own `bg` | at rest |
| focused | `palette.hot` `#FF7A1A` | cursor on the button, plus the engine's own focused repaint |
| pressed | `palette.hot` `#FF7A1A` | held down |

Both interactive states are the *same* saturated orange and neither is derived from
the base colour. Scaling the base is what made the highlight invisible before: a
near-black button multiplied by 0.75 is a shadow, and multiplied by 1.15 is still
near-black. That is why the keyboard keys, the prefix tiles and the small `+`/`-`
steppers appeared not to highlight at all.

Three families are distinguished at rest, so a control reads as a control before it
is touched:

* `palette.orangeDim` `#A8480C` -- the row pager, the six parameter steppers,
  **STOP ALL**, **UNDO**, and the group pager
* `palette.redDeep` `#5C1A12` -- **DELETE ALL**
* `palette.red` `#F04437` -- **CLOSE**

Tabs are the exception, because a tab has to stay lit *after* the click rather than
only while it is held. All three -- **SOUND**, **VISUAL**, **FAVOURITES** -- carry
a resting `palette.line` background, and whichever is selected carries
`palette.hot` as a held field rather than as a transient state. Hover feedback
would have been the natural way to do this; a field is what is left.

`gen-scene.mjs` asserts that no two nodes in the header band overlap. The armed
read-out and the FAVOURITES tab once shared the same strip, and a screenshot was
the only thing that noticed.

## Debug logging on/off

**DEBUG ON / DEBUG OFF**, next to the title in the header. **Off by default** -- a
debug log is something you switch on to diagnose a problem, not something that runs
forever. It gates every `console.log`
the mod writes, and the button's label and colour both say which state it is in.

One switch for the whole mod instance, not per player: a Portal mod is a single
instance serving everyone, so "who turned it on" has no useful answer here.

The export deliberately **ignores** the switch. Its entire purpose is to write to
the log, so routing it through the same gate would let you silence the one thing you
came for -- it uses `logAlways()`, and the gate asserts that.

## What a playtest found: chips were keyed by the wrong thing

The single worst bug in this project so far, and none of the gates caught it.

`ensureWidget()` stores a widget under the action string it was created with, and
bakes that string into the button's `onClickUp` closure. The filter chips were keyed
by action, which collides the moment the two tabs disagree:

| tab | actions | slots |
| --- | --- | --- |
| sfx | `fa`, `fd3`, `fd2`, `fl`, `fo` | 0, 1, 2, 3, 4 |
| vfx | `fa`, `fw`, `fp` | 0, 1, 2 |

`fp` is created at slot 2 on the vfx tab. `fd2` was already created at slot 2 on the
sfx tab. **Two buttons, one position.** `fd2` sits on top of `fp`, and `dim` does
not apply to vfx, so clicking PLAYER appeared to do nothing at all.

The leftover hiding was broken the same way: the code looked up
`ui.nodes["chip" + i]` to hide unused slots, but no node is ever keyed `"chipN"` --
they are keyed by action -- so every lookup missed. The sfx tab's LOOP and ONE
buttons stayed on screen over the vfx tab's real chips, competing for the same
clicks. That is the "after a while the tabs stop responding" report.

Two more chip bugs rode along:

* `chipTextKey()` tested the key before the value, so the ALL chip (whose value is
  empty) fell through to its sibling and rendered as **2D** on the sfx tab and
  **PLAYER** on the vfx tab.
* `chipIsActive()` compared the empty value against the empty filter, so ALL was
  permanently blue.

The chips are now keyed by **slot**, with the action read through the resolver
`ensureWidget()` already had for the keyboard tiles. One button per slot, one
position per slot, and the leftover hider finally finds its node.

## The group rail had 42 unreachable groups

It showed 19 rows against **61 sfx groups and 52 vfx groups**. Two thirds of the
categories could not be selected at all. It now pages: prev, `GROUPS n / m`, next,
independent of the list's pager -- changing category and losing your place in the
results are different intentions and should not be coupled.

Rail slots are page-relative, so `rail<slot>` became `slot + railPage *
visibleRows`, and `visibleRows` is read from the scene rather than written down in
`index.ts`.

Separately, `rail0` was **rejected outright** by a leftover `row < 1` guard from
when the rail was 1-based. It looked fine at first only because the menu opens on
group 0 anyway; the moment you picked anything else there was no way back. That is
the "clicking on ALL does nothing" report.

## Selecting is one click now

Clicking SELECT in a row only set `ui.selectedKey`; arming needed a second click on
the header. The log was full of `r0_sel, r0_sel, btnSelect`. A row's SELECT now arms
it directly, and the menu stays open -- closing is the header's job, and auditioning a
list should not yank the browser away on every pick.

The row's other button is a labelled **PLAY**, not a bare `S` glyph.
`preview()` already auditioned without the gadget; the affordance was just too small
to find. It plays the sound, spawns the effect a few metres ahead, and does **not**
arm anything, so browsing a list never changes what fire will spawn.

## STOP ALL

DELETE ALL removes the placed effects. Nothing stopped the *sounds*, so a long
audition kept ringing. STOP ALL sits beside UNDO and silences only the handles this
mod owns (`st.playing`), leaving placed effects alone.

## Hover highlight

Every button brightens under the cursor, and its label brightens with it.

Portal's native button does have a hover state — `AddUIButton`'s overloads take
`hoverColor` and `hoverAlpha` — but `bf6-portal-utils/ui` does not expose it.
`UIBaseButton.Params` has `baseColor`, `disabledColor`, `pressedColor` and
`focusedColor`, no hover pair, and `ui/index.ts:245` logs `"HoverIn and HoverOut
button events not supported"`. Reaching past the package to set it would be exactly
what `AGENT.md` §5 forbids.

So the highlight is driven from focus, which the package does support: the utils
route the engine's `FocusIn`/`FocusOut` events and expose them as
`onFocusIn`/`onFocusOut`, and Portal focuses the widget under the cursor when
input mode is on. `baseColor` and the label colour flip to the brightened palette
entry and back. The engine's own `focusedColor` is set to the same value, so if it
repaints that state there is a second, independent highlight.

**This was tested and it does not work.** Across a full playtest not one button
highlighted. `bf6-portal-utils/ui` does not route a hover event at all -- its own
`ui/index.ts:245` logs `"HoverIn and HoverOut button events not supported"` -- and
`UIBaseButton.Params` has no hover colour, so a handler wired to focus can never
fire on cursor movement. The engine's `hoverColor` exists only in the raw
`mod.AddUIButton` overloads, which `AGENT.md` §5 forbids this mod from calling.

So there is no hover to be had through the package, and the UI now brightens on
**mouse-down** and settles on mouse-up instead, using only APIs the package exposes.
The `onFocusIn` handler is kept wired, so if Portal ever maps cursor-over to focus
the hover feature is already there.

This is a genuine gap against what was asked for, and it is the package's gap rather
than this mod's. The honest fix is `bf6-portal-utils` exposing `hoverColor` and
routing `HoverIn`.

## Architecture

```
banlist.json ──┐
               ├─> tools/gen-catalog.mjs ──> src/catalog.ts  (936 SFX + 312 VFX)
SDK enums ─────┘                          └─> src/catalog.json (preview metadata)

src/scene.json ─────> tools/gen-scene.mjs ──> src/scene.gen.ts ──> src/ui.ts
                             └──────────────> preview/src/sandbox.js
```

`src/scene.json` is the single source of geometry and palette. The mod and the
browser preview both render it, so they cannot drift. Edit the JSON, run
`npm run gen`, and both move together.

`src/ui.ts` exposes **one unified `Row` type** across both tabs:

| `Row.type` | Meaning | Spawned / applied by |
| --- | --- | --- |
| `sfx` | catalog sound | `SpawnObject` + `PlaySound` |
| `spawn` | catalog visual effect | `SpawnObject` + `EnableVFX`/`SetVFXScale`/`SetVFXColor` |
| `screen` | player-wide effect | `EnableScreenEffect` / `SetSoldierEffect` |

Only the active tab is rendered, so the live widget count stays ~200 regardless
of catalog size.

| File | Role |
| --- | --- |
| `banlist.json` | Known game-crashing assets. One line each. |
| `tools/gen-catalog.mjs` | Parses the enums, filters the banlist, derives names/groups |
| `tools/gen-scene.mjs` | `scene.json` → `scene.gen.ts`, with layout validation |
| `tools/gen-sandbox.mjs` | Generates the browser preview from the same two sources |
| `tools/check-actions.mjs` | Proves `handle()` covers every action `ui.ts` can emit |
| `tools/check-dist.mjs` | Delivery gate (see below) |
| `src/catalog.ts` | **GENERATED** — 936 SFX + 312 VFX |
| `src/scene.json` | Layout + palette. Edit this. |
| `src/ui.ts` | Renders the scene graph onto `bf6-portal-utils/ui`; per-player UI state |
| `src/index.ts` | Events, spawn/play/dispose lifecycle, and `handle()` |
| `src/diag.ts` | Shared `console.log` sink; wires the utils' own logger to it |
| `src/config.ts` | Tunables |

## The UI layer is `bf6-portal-utils/ui`

The widget layer is **not** hand-rolled. `src/ui.ts` builds every element from the
package's own components, and three of its rules are load-bearing enough to restate
here, because breaking any of them produces dead buttons rather than an error.

**1. No direct `mod.*UI` calls anywhere in `src/`.**
No `AddUI*`, `SetUI*`, `DeleteUIWidget`, `EnableUIInputMode`, or
`GetUIWidgetName`. `tools/check-invariants.mjs` fails the build if any appear.
This is `AGENT.md` §5, and it is also the whole reason the buttons work: the old
hand-rolled layer had to invent its own naming scheme and its own router, and the
two drifted apart silently.

**2. There is exactly one click path.**
Each `UITextButton` gets an `onClickUp` closure that calls
`setActionHandler(...)`, and `index.ts`'s `handle()` is reached from there. The mod
must **not** subscribe to `OnPlayerUIButtonEvent` — `ui/components/base-button/index.ts`
already does, and that single subscription is what routes a click to the right
element. The old `"w<playerId>_<action>"` naming, `BUTTON_SUFFIX`, and the
`GetUIWidgetName` parse are all gone. `tools/check-bundle.mjs` asserts the shipped
bundle contains exactly one such subscription.

**3. Input mode belongs to the root container, not to us.**
The root `UIContainer` carries `uiInputModeWhenVisible: true`, and the package
reference-counts `mod.EnableUIInputMode` against its visibility. Their README is
explicit that mixing a manual call with that is unsupported: the engine has no way
to query the current state, so a manual call deadlocks the count. `setOpen()` is
therefore just `ui.open = open` plus a log line, and `render()` pushes the
visibility through.

### Why the action contract needed its own gate

`ui.ts` emits a string; `handle()` compares a string. Nothing in the type system
connects them, so a disagreement is invisible: the click falls through every branch
and returns. Three such breaks existed when this migration started, and all three
passed review and typechecking.

| Emitted | Expected | Symptom |
| --- | --- | --- |
| `chipfd3` | `fd3` | Fell into the `c*` branch; `parseInt("hipfd3")` was `NaN` |
| `spc` | `kbdspc` | All five bottom-row keys dead |
| `rail0` | `c0` | Group rail dead |

`tools/check-actions.mjs` closes this. `gen-scene.mjs` emits `NODE_ACTIONS` from
the same data the node ids come from, so the list cannot drift from the scene; the
gate then asserts every action is handled, that `handle()` tests nothing nothing
emits, and that the dynamic families (`key_`, `pfx_`, `rail<n>`, `r<n>_<tag>`) are
built on one side and recognised on the other. `handle()` also ends with an
`UNHANDLED ACTION` log, so a future mismatch is visible in the pasted log instead
of being a button that quietly does nothing.

`npm run test:gates` proves the gate still bites by re-injecting each of the three
defects and confirming it fails.

### Widget budget

The package caps at `MAX_ELEMENTS = 2048` and `MAX_BUTTONS = 512`. The menu's
heaviest state is the simulated keyboard, at roughly 143 buttons per player, so
four players in the keyboard stay under the button cap but are the reason the root
is allocated once and updated in place rather than rebuilt per frame.


## The banlist

```json
{ "assets": [
    { "name": "SFX_Levels_Brooklyn_Spots_EmergencyExit_SimpleLoop3D",
      "reason": "Crashes the Battlefield 6 Portal instance on play" },
    { "name": "SFX_Levels_Brooklyn_Shared_Spots_Water_Splash_Head_SimpleLoop3D",
      "reason": "Crashes the Battlefield 6 Portal instance on play" }
]}
```

Add a crasher, run `npm run gen`. The generator **fails the build** if a name is
not a real `SFX_` member, so a typo cannot silently disable the guard.

Every reference the mod makes is a *symbolic* `mod.RuntimeSpawn_*.X` member —
never a numeric literal. A banned asset is absent from `SFX_CATALOG`, so there is
no value in the bundle it could be reconstructed from and no code path that can
name it. `BannedProof` keeps a `typeof` reference to each so `tsc` still proves
the names are real enum members.

## Three things that look like bugs but aren't

**1. `dist/bundle.ts` starts with `// @ts-nocheck`.** The bundler adds it, which
makes a plain `tsc` on the bundle pass on *unparseable* output — it already did
once, when an imported `.json` got inlined as a bare `{ ... }` block.
`tools/check-dist.mjs` strips the directive into a temp file and typechecks that.
Verified to fail on a planted error.

**2. `src/catalog.json` exists but nothing in the mod imports it.** The Portal
bundler cannot import `.json` at all. The sidecar is only for the Node
generator/preview; `catalog.ts` and `scene.gen.ts` are the real modules.

**3. Durations are a playback window, not metadata.** The SDK exposes no
duration for `RuntimeSpawn` SFX. `0:00`–`0:03` on a sound row is the window *we*
apply so loops get bounded and one-shots get cleaned up.

## Fidelity gaps

Portal's UI system is much narrower than a browser. `UIBgFill` is only
`Blur | Gradient{Bottom,Left,Right,Top} | None | Outline{Thin,Thick} | Solid`, and
`UIImageType` is a fixed 8-icon enum — **there is no custom texture upload**.

| Wanted | In game | Why |
| --- | --- | --- |
| Rounded corners | Square | No border-radius in `UIBgFill` |
| Diagonal hazard stripes | Alternating vertical slivers | Containers cannot rotate |
| Waveform / any image | Duration bar + meter slivers | No texture upload |
| Outer drop shadow | `OutlineThin` inset border | Closest available |
| "click name to copy" | Static reference text | No clipboard API |
| Circular buttons | Square, with real colour states | No circle primitive |

The preview renders the *true* Portal output and does not fake browser-only
effects, so nothing surprises you in game.

## UNVERIFIED — test in game before trusting

1. **`mod.SpawnObject` on an `FX_` member returning a usable `mod.VFX`.** Return
   type is `Any`; the cast mirrors the SDK example's shape for SFX but is
   inference, not a verified signature. If it misbehaves, the whole VFX spawn path
   is one function (`spawnVfx`).
2. **`mod.SetVFXScale` range.** `CONFIG.minScale`/`maxScale` (0.25–4.0) is a
   guess. If effects vanish at the top, the engine's usable band is narrower.
3. **`mod.SetVFXColor` on a spawned effect.** Applied as (1,1,1) — i.e. "leave
   the asset's own colour". If it tints everything, drop the call.
4. **`U+25B6` ▶, `U+25C6` ◆, `U+25C9` ◉, `U+2630` ☰ in the BF Text font.** Any
   may render as a missing-glyph box. Fallbacks are in `CONFIG` and `scene.json`.
5. **Player-wide effect persistence.** `EnableScreenEffect`/`SetSoldierEffect`
   are not reset by `DELETE ALL` on *other* players, and a soldier effect may
   survive death. `OnPlayerLeaveGame` clears this player's.
6. **Per-player widget cost.** ~144 live elements on a full list view
   (13 rows × 9 + ~50 chrome + 19 rail), and roughly 143 buttons in the
   simulated keyboard, which is that view's heaviest state. The package caps at
   `MAX_ELEMENTS = 2048` / `MAX_BUTTONS = 512`, so four players in the keyboard is
   the number worth watching. Fine below that; at 64, consider team-shared UI.
7. **Playback windows.** A one-shot stops 1 s after its recorded length (5 s for
   the 14 whose recording filled the capture slot, never under 2.5 s); a loop
   after 8 s. Lengths are in `src/sound-lengths.json`, imported by
   `tools/import-lengths.mjs` from tabbedscamper's BF6 Portal SoundBoard
   (https://github.com/TabbedScamper/BF6_Portal_SoundBoard). `gen-catalog.mjs`
   fails on a one-shot with no length unless `NO_LENGTH` lists it with a reason,
   so re-run the import when the SDK adds sounds. Each player plays at most
   `CONFIG.maxSoundsPerPlayer` (16) at once, since each pending stop holds one of
   the 512 timers `bf6-portal-utils/timers` shares across the server.
8. **The `Events` module caveat.** `sounds/README.md` warns that using `Events`
   forbids exporting your own Portal handlers. This mod subscribes through
   `Events` and exports nothing, which satisfies it — but confirm Portal accepts
   a subscription-only mod.
9. **That the utils' input-mode reference count behaves in a real match.** The
   gates prove `src/` never calls `mod.EnableUIInputMode` and that the root
   carries `uiInputModeWhenVisible: true`. What they cannot prove is that
   `bf6-portal-utils/ui` acquires and releases the cursor exactly once per open
   and close. If the player loses the cursor or cannot get it back, the pasted log
   will show the package's own logger output — wired to `console.log` in
   `src/diag.ts` — next to the `menu opened` / `menu closed` lines.
10. **That the hover highlight appears.** See the hover section above: it depends
    on Portal mapping cursor-over to `FocusIn`. Nothing outside the game can confirm
    that, and no `bf6-portal-utils` API asserts it.
11. **That a click reaches `handle()`.** Every button logs
    `button: <action> | ...` on the way in, and anything unclaimed logs
    `UNHANDLED ACTION "<action>"`. A dead button is therefore visible in the
    pasted log: no `button:` line means the click never arrived, and an
    `UNHANDLED ACTION` line means it arrived and found no route. Neither is
    checkable outside the game.

## Grounding

- **Tier 0** — `main_resources/types_original/mod/index.d.ts`:
  `SpawnObject` (`:34620`), `UnspawnObject` (`:33227`), `GetSFX`/`GetVFX`
  (`:34524`/`:34533`), `PlaySound` (`:32850`–`:32889`), `StopSound` (`:32928`),
  `EnableVFX`/`MoveVFX`/`SetVFXColor`/`SetVFXScale`/`SetVFXSpeed`
  (`:32994`–`:33006`), `EnableScreenEffect` (`:32991`), `SetSoldierEffect`,
  `ScreenEffects` (`:31879`), `SoldierEffects` (`:31891`), `AddEquipment`,
  `AddUIButton`/`AddUIText`/`AddUIContainer`, `FindUIWidgetWithName` (`:35070`),
  `GetUIRoot` (`:35118`), `GetUIWidgetName` (`:35075`), `SetUIWidgetSize`,
  `SetUIWidgetVisible`, `DeleteUIWidget`, `SetUIText*`, `UIBgFill`, `UIAnchor`,
  `UIDepth`, `UIImageType`, `UIButtonEvent`, `Message`, `stringkeys`
- **Tier 0 events** — `event-handler-signatures.d.ts`: `OnPortalGadgetFireStart`,
  `OnPortalGadgetAimStart/Stop`,
  `OnPlayerUIButtonEvent`, `OnRayCastHit`, `OnRayCastMissed`,
  `OnPlayerDeployed`, `OnPlayerLeaveGame` (delivers a `playerId: number`, not a
  `Player`)
- **Tier 0 utils** — `bf6-portal-utils/events` (channel subscribe; owns all
  handlers), `timers` (`setTimeout`, driven by `Events.OnTickStart`),
  `sounds/README.md` (2D-vs-3D rules, the `SpawnObject(...) as mod.SFX` cast),
  `clocks` (`Date.now()` as the only clock source in QuickJS)
- **Tier 0 catalog** — `runtime-spawn-enums/*.d.ts`: 938 `SFX_` and 312
  `FX_`/`VFX_` in `common`, 222 more `FX_` map-specific
- **Tier 1** — `mods_original/PortalGadgetExample/PortalGadgetExample.ts` (gadget
  event flow, raycast, `SpawnObject`→`PlaySound` cast);
  `mods_original/VL7Example/VL7Example.ts` (`ScreenEffects.VL7` +
  `SoldierEffects.VL7Effect` usage, and the `VL7Cloud` map-object alternative);
  `bf6-portal-ui-preview-main/src/sandbox.js` (preview call conventions)
- **House pattern** — `PowerStruggle/src/index.ts`: `Events.*.subscribe(...)` +
  raw `mod.AddUI*`/`SetUI*` + `GetUIWidgetName` substring routing
- **Tier 2** — `CustomCQ` / `CustomBT` ignored: no bearing on UI or audio, and
  unreliable per AGENT.md §2

## MUSIC / RADIO tester (2026-10-01)

**No scripted music plays on the Portal Sandbox map.** Every other map plays it. This was isolated with `probe/MusicProbe.ts`, a standalone script that copies the SDK doc and CustomConquest calls verbatim; `npm run test:probe` type-checks it and locks its calls. Test music on any other map.

Spec: `docs/superpowers/specs/2026-10-01-music-radio-tester-design.md`. Plan: `docs/superpowers/plans/2026-10-01-music-radio-tester.md`.

| Piece | Role |
| --- | --- |
| `tools/gen-music.mjs` | Reads `MusicPackages` / `MusicEvents` / `MusicParams` from `types_original/mod/index.d.ts` and writes `src/music.gen.ts` + `src/musickeys.json`. Holds the param ranges and the one-line on-screen descriptions (`DESC`), both from the SDK Music System docs. Fails if a listed event or param has no description, or one longer than 96 characters (one panel line). Fails if a package has no `*_Stop` or `*_Amplitude`, or more params than the 5 UI rows. |
| `src/tester.ts` | Per-player tester state, the `mt*` action handler (player overloads for `FOR: ME`, global ones for `FOR: EVERYONE`), the load gate, and `testerFields()` for the panel. |
| `scene.json` | The `tester` group (four cards) and the `browser` group, which now wraps the asset browser body so the tester tabs can hide it. |
| `tools/test-tester.mjs` | Replays the bundle, clicks through both tabs, and asserts the exact `LoadMusic` / `PlayMusic` / `SetMusicParam` calls. |

Hidden scene nodes are no longer created until their group is first shown (`buildNodes`), so the tester panel costs nothing until it is opened.

## Widget batching and the crash gate (2026-10-01)

Since 2026-10-01 the game client crashes when about 245 UI widgets are created in one tick. The script logs `render end`, and then the engine dies. `renderBatch()` caps new elements per pass (`CONFIG.widgetsPerBatch`, `CONFIG.widgetBatchDelayMs`). `tools/test-ui-batching.mjs` (`npm run check:batching`) replays the bundle and fails if any pass creates more than 100 engine widgets, or if the batched final UI differs from an unbatched copy.

## Commands added

- `npm run release` builds, then copies `dist/` to `SfxVfxShowcase.ts` + `SfxVfxShowcase.strings.json`, the two files to upload.
- `npm run test:tester` runs the tester behaviour test. It is also part of `build`.

