# Music and radio templates: design

Date: 2026-10-01. Status: approved in chat, awaiting spec review.

## Goal

The user finds a music or radio setup they like in the MUSIC / RADIO tester. Noting the
package, track, every param and the volume down by hand takes too long. A template saves
that setup in one click, lists it in FAVOURITES next to the saved sounds and effects, puts
it back into the tester on demand, and EXPORT writes it out as plain names and values.

Agreed with the user:

- The output is names and params only. No code is generated.
- Templates show in the FAVOURITES tab, can be clicked to re-apply, and are written by
  EXPORT.
- P on a template loads its package if needed, then plays.

## Constraint that shapes the UI

`mod.Message` takes at most 3 arguments, and an argument is a strings.json key or a
number, never another Message (`tools/gen-text.mjs`, TEMPLATES). One text widget cannot
show a whole template (a Core template has 5 values). So:

- The FAVOURITES row shows the track or station and a short summary.
- The full settings are visible in the tester after OPEN.
- EXPORT writes the full line to the log, where there is no such limit.

## 1. Saving

A **SAVE TEMPLATE** button on the MUSIC and RADIO tabs, in the bottom card. The LAST CALL
read-out (`mtLast`, x736 w718) is narrowed to make room. The button sits between it and
FOR: ME, with the caption "Saves to FAVOURITES." under it like the other bottom-card
buttons. The exact geometry is settled at implementation and checked in the preview for
overlap and overflow.

What is saved:

| Tab | Saved |
|---|---|
| MUSIC | package, selected track (event), every param of the package, the package volume |
| RADIO | Radio_Channel, Radio_Biome, Radio_ContinueQueueOnTrackEnd, Radio_LoopQueuedTracks, Radio_Amplitude, and the tracks queued since the last CLEAR QUEUE, in order, each with its channel and biome |

Behaviour:

- **Values come from the panel.** They are what the panel shows (`TesterState.values`), the
  same values PLAY sends. Target (ME / EVERYONE) is not saved: it is a test setting, not
  part of the music.
- **No duplicates.** Saving a setup identical to an existing template (same content,
  ignoring its number) adds nothing. The notification names the existing template instead.
- **Numbering.** Templates are numbered per player in save order: MUSIC TEMPLATE 1,
  RADIO TEMPLATE 2, and so on. Numbers are never reused within a match.
- **Feedback.** On save: the favourite "on" sound (`UI_SOUND.on`) and a notification,
  "Saved as MUSIC TEMPLATE 3".
- **Package not loaded.** Saving does not need the package loaded, so SAVE TEMPLATE is never
  greyed out.

## 2. In FAVOURITES

A template is a new kind of favourites row. It sits in the same list as the saved sounds
and effects, in save order.

| Row part | Template row |
|---|---|
| Type badge (b1) | MUSIC or RADIO |
| Name | MUSIC: the event (`Core_LastPhaseBegin`). RADIO: the station of the first queued track (`BF Themes`), or of the channel and biome if the queue is empty |
| Second line | `MUSIC TEMPLATE {n}`, or `RADIO TEMPLATE {n} - {count} tracks` |
| fav (★) | removes the template |
| SELECT, labelled **OPEN** | switches to the MUSIC or RADIO tab with every saved value applied. Nothing is sent to the engine |
| P | applies the template, then plays it (below) |
| STOP | sends the template package's stop event, if that package is loaded |

**P on a MUSIC template:**

1. Apply the template.
2. LOAD its package if it is not the loaded one (same exclusive load as the LOAD button).
3. Do exactly what PLAY does: send every param and the volume, then the event. If a load
   was needed, these are held until it finishes.

**P on a RADIO template:**

1. Apply the template.
2. LOAD Radio if needed.
3. Send, in this order:
   - `Radio_ClearQueue`;
   - for each saved track: `Radio_Channel`, then `Radio_Biome`, then `Radio_QueueTrackNumber`.
     Channel and biome are re-sent only when they change from the previous track;
   - the saved channel, biome, continue, loop and volume;
   - `Radio_Play`.

   The tester's own queue state (count and last added) is updated to match.

**Search and filters.** Search matches the row's name text (the event or station). The
3D/2D, loop/one-shot and world/player filters describe sounds and effects, so templates are
hidden while any of them is on.

**Rows that are not templates are unchanged.** All other FAVOURITES behaviour stays as it is.

## 3. EXPORT

The FAVOURITES EXPORT button writes the sounds and effects as now, then one line per
template, in save order, through `logAlways`. Plain text, not code:

```
MUSIC TEMPLATE 1 | Core | Core_LastPhaseBegin | Core_IsWinning 0, Core_PhaseUrgency 0.5, Core_Sector 0, Core_Urgency 3 | volume 1
RADIO TEMPLATE 2 | channel 2 BF Themes | queue #3, #4, #7 | continue 1, loop 1 | volume 3
```

- **Mixed stations.** When the queue spans more than one station, each entry names its own:
  `queue BF Themes #3, Rock #0`.
- **Biome channel.** Channel 4 shows its biome: `channel 4 Egypt`.
- **Count.** The count in the header and in the "Exported {n}" message includes the templates.

## 4. Where the code goes

- **src/tester.ts** owns the template model:
  - `Template`, a discriminated union of music and radio;
  - capture from TesterState;
  - apply to TesterState;
  - the play sequence;
  - the export line.

  The radio queue state becomes the full list of queued picks. Today it is only a count and
  the last pick; the count and "last added" read-out are derived from the list.
- **src/ui.ts:**
  - adds a `tpl` Row kind;
  - `favRows` resolves `tpl<n>` keys from the player's templates;
  - the row fields for a template row.
- **src/index.ts:**
  - routes `mtSave`;
  - routes P / OPEN / STOP / ★ on template rows to tester.ts;
  - extends `exportFavourites`.
- **src/scene.json:** the SAVE TEMPLATE button and its caption.
- **tools/gen-text.mjs:** new labels and templates (ASCII).

Templates are kept in the player's favourites (`ui.favourites` holds `tpl<n>` keys, in
order), with their data in the player's tester state.

## 5. Limits

- **Templates last for the match only**, like the sound favourites: Portal has no saved
  storage. EXPORT is how to keep them.
- **Track names are numbers.** The SDK gives no song names, only numbers.

## 6. Testing

Replay tests in `tools/test-tester.mjs`, written first:

- **Save:** SAVE TEMPLATE adds a FAVOURITES row with the right badge, name and second line,
  and saving again with identical settings adds nothing.
- **OPEN:** restores the package, track, every param and the volume. It sends no music call.
- **P on a MUSIC template:** the exact call sequence, including the LOAD when another
  package is loaded and the hold until loading ends.
- **P on a RADIO template:** the exact call sequence (clear, per-track channel, biome and
  number, settings, play).
- **★ removes the template. EXPORT writes the exact lines.**
- **Gates:** the batching gate stays under the 100 widgets per pass limit (peak today: 74),
  and the field, action and layout gates pass.
- **Preview:** checked for overlap and overflow on both tester tabs.
