# Music and Radio Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click saves the MUSIC or RADIO tester's current setup as a template. Templates are listed in FAVOURITES, can be opened back into the tester or played from there, and EXPORT writes them as plain text lines.

**Architecture:**
- `src/tester.ts` owns the template model: capture, apply, play sequence and export line. It already owns every music call.
- `src/ui.ts` gains a `tpl` Row kind, so templates flow through the existing FAVOURITES list, paging and row buttons.
- `src/index.ts` routes the new `mtSave` action, the template row buttons and EXPORT.
- Tests are replays of the shipping bundle (`tools/test-tester.mjs`), driven through the real UI.

**Tech Stack:**
- Battlefield 6 Portal TypeScript on QuickJS, with the global `mod` API and bf6-portal-utils (ui, timers, events, sounds).
- Node replay harness `tools/ui-replay.mjs`.
- Generated tables: `tools/gen-text.mjs` writes `src/text.gen.ts` and `src/strings.json`, and `tools/gen-music.mjs` writes `src/music.gen.ts`.

**Spec:** `docs/superpowers/specs/2026-10-01-music-templates-design.md`

## Global Constraints

- Every on-screen string is a strings.json key passed to `mod.Message`, with at most 3 arguments. An argument is a key or a number, never another Message. All text is ASCII (`gen-text.mjs` fails the build otherwise).
- Never add text to a field as a raw string: use `K(...)`, `mod.Message(...)` or a `T.*` key (`tools/check-fields.mjs` gate).
- Each render pass must create fewer than 100 widgets (`npm run check:batching`; today's peak is 74).
- Every music call is written to the log (`log("music: ...")`). The tester test counts calls against log lines.
- Output is names and params only. No code is generated.
- Templates last for the match only, and are numbered per player in save order, never reused.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not stage `probe/MusicProbe.ts`, which holds the user's own uncommitted change.
- Full gate: `npm run build` (gen, typecheck, all checks, bundle, batching, tester and probe tests). The tester test alone, after a rebuild: `npm run gen && npm run bundle && node tools/test-tester.mjs`. Check `package.json` for the exact bundle script name if `bundle` differs.

## Review Focus

1. **A radio queue built from several stations.** EXPORT must name each queued track's station, and P must re-send Radio_Channel and Radio_Biome before each track whose station differs from the previous one. Pinned in Task 4, with a mixed-station save.
2. **Saving the same setup twice.** It must not add a second row, and the notification must name the existing template. Pinned in Task 2.
3. **A filter chip turned on in FAVOURITES.** Template rows must disappear and come back when the chip is turned off. Pinned in Task 2.
4. **OPEN on a radio template.** It must not send anything or change the tester's record of the engine queue. Only P rebuilds the queue. Pinned in Task 3.
5. **STOP on a template whose package is not loaded.** It must send nothing and show the "not loaded" notification, like the greyed-out tester buttons. Pinned in Task 3.

---

## File Structure

- `src/tester.ts` (modify):
  - the radio queue becomes a list;
  - the `Template` model: `saveTemplate`, `applyTemplate`, `playTemplate`, `stopTemplate`, `removeTemplate`, `findTemplate`, `templateKey`;
  - row text helpers: `templateName`, `templateNameKey`, `templateLine`, `templateKindKey`;
  - `templateExportLine`.
- `src/ui.ts` (modify):
  - `tpl` Row kind and its row fields;
  - `favRows` resolves `tpl<n>` keys;
  - filters hide templates.
- `src/index.ts` (modify):
  - `mtSave`;
  - template row buttons;
  - EXPORT lines.
- `src/uisound.ts` (modify): `mtSave` gets no generic click sound, because save plays its own.
- `src/scene.json` (modify): SAVE TEMPLATE button and caption. LAST CALL is narrowed.
- `tools/gen-text.mjs` (modify):
  - labels `kindMusic`, `kindRadio`, `tplOpen`;
  - templates `tplMusicOf`, `tplRadioOf`, `tplSaved`, `tplExists`;
  - emits `RADIO_TEXT`.
- `tools/ui-replay.mjs` (modify): `visibleTexts()` and `clickText(key, nth)`.
- `tools/test-tester.mjs` (modify): template tests.
- `tools/gen-sandbox.mjs` (modify): preview fields for the new button.
- `description.md` (modify): user docs.

---

### Task 1: Radio queue as a list

The panel tracks the queue as a count and the last pick. Templates need every pick in order, so store the list and derive the count and the last pick from it. Behaviour does not change, so the existing tester tests are the safety net.

**Files:**
- Modify: `src/tester.ts`, at the `TesterState` interface, `RadioPick`, `newTesterState`, `queueIsStale`, `noteQueued`, `queueLine` and the radio clear in `handleTesterAction`.

**Interfaces:**
- Produces:
  - `export interface RadioPick { ch: number; biome: number; track: number }`, now exported;
  - `TesterState.queue: RadioPick[]`, which replaces `queued` and `lastQueued`.

- [ ] **Step 1: Run the tester test to record the green baseline**

Run: `npm run gen && npm run bundle && node tools/test-tester.mjs`
Expected: a line starting `  tester  :` and exit 0.

- [ ] **Step 2: Replace the two fields with the list**

In `TesterState` replace:

```ts
    /** Tracks queued since the last CLEAR QUEUE. The engine cannot be asked. */
    queued: number;
    /** Station and number of the last track queued, until CLEAR QUEUE. */
    lastQueued: RadioPick | undefined;
}

interface RadioPick {
```

with:

```ts
    /** Tracks queued since the last CLEAR QUEUE, in order. The engine cannot be asked. */
    queue: RadioPick[];
}

export interface RadioPick {
```

In `newTesterState` replace `queued: 0, lastQueued: undefined` with `queue: []`.

In `queueIsStale` replace `const q = st.lastQueued;` with `const q = st.queue[st.queue.length - 1];`.

In `noteQueued` replace:

```ts
    st.queued++;
    st.lastQueued = { ch: ch, biome: biome, track: track };
```

with:

```ts
    st.queue.push({ ch: ch, biome: biome, track: track });
```

In `queueLine` replace the body with:

```ts
    const q = st.queue[st.queue.length - 1];
    if (q === undefined) return mod.Message(T.mtQueueEmpty);
    return mod.Message(TPL.mtQueueCount, st.queue.length, stationKey(q.ch, q.biome), q.track);
```

In the radio branch of `handleTesterAction`, replace:

```ts
                if (e === RADIO_CLEAR) {
                    st.queued = 0;
                    st.lastQueued = undefined;
                }
```

with:

```ts
                if (e === RADIO_CLEAR) st.queue = [];
```

- [ ] **Step 3: Run the full gate**

Run: `npm run build`
Expected: exit 0. The `tester  :` line is unchanged from Step 1.

- [ ] **Step 4: Commit**

```bash
git add src/tester.ts dist/bundle.ts dist/bundle.strings.json
git commit -m "Tester: keep the radio queue as a list of picks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: SAVE TEMPLATE and the FAVOURITES rows

**Files:**
- Modify: `tools/ui-replay.mjs` (new `visibleTexts`, `clickText`)
- Modify: `tools/test-tester.mjs` (save tests)
- Modify: `tools/gen-text.mjs`, `src/tester.ts`, `src/ui.ts`, `src/index.ts`, `src/uisound.ts`, `src/scene.json`, `tools/gen-sandbox.mjs`

**Interfaces:**
- Consumes: `RadioPick`, `TesterState.queue` (Task 1).
- Produces (all in `src/tester.ts`):

  ```ts
  export interface MusicTemplate { kind: "music"; n: number; pkg: string; evt: string; values: Record<string, number> }
  export interface RadioTemplate { kind: "radio"; n: number; values: Record<string, number>; queue: RadioPick[] }
  export type Template = MusicTemplate | RadioTemplate;
  // TesterState gains: templates: Template[]; nextTemplate: number;
  export function saveTemplate(tab: TesterTab, st: TesterState): { tpl: Template; added: boolean };
  export function templateKey(t: Template): string;              // "tpl" + n
  export function findTemplate(st: TesterState, key: string): Template | undefined;
  export function templateName(t: Template): string;             // plain text: event name or station
  export function templateNameKey(t: Template): string;          // strings key of the same
  export function templateLine(t: Template): mod.Message;        // "MUSIC TEMPLATE 2" / "RADIO TEMPLATE 1 - 2 tracks"
  export function templateKindKey(t: Template): string;          // T.kindMusic / T.kindRadio
  ```

- `src/ui.ts`: `Row` gains `{ readonly type: "tpl"; readonly tpl: Template }`.
- `tools/ui-replay.mjs`:
  - `session.visibleTexts()` returns `[{ msg: any[], x: number, y: number }]` sorted by y, then x;
  - `session.clickText(key, nth = 0)`.

- [ ] **Step 1: Add the replay helpers**

In `tools/ui-replay.mjs`, add after `export function finalState` (module level):

```js
/**
 * Every widget's final state, with its absolute position and whether it and all
 * its ancestors are visible. Positions in Portal are relative to the parent.
 */
function widgetTree(calls) {
    const w = {};
    for (const c of calls) {
        if (/^AddUI/.test(c.name)) {
            w[c.args[0]] = { kind: c.name, parent: c.args[4]?.widget, pos: c.args[1].v, vis: c.args[5], msg: c.name === "AddUIText" ? c.args[10]?.msg : undefined };
            continue;
        }
        const n = c.args[0]?.widget;
        if (n === undefined || w[n] === undefined) continue;
        if (c.name === "SetUIWidgetVisible") w[n].vis = c.args[1];
        else if (c.name === "SetUITextLabel") w[n].msg = c.args[1]?.msg;
        else if (c.name === "SetUIWidgetPosition") w[n].pos = c.args[1].v;
    }
    const shown = (n) => {
        for (let p = n; p !== undefined && w[p] !== undefined; p = w[p].parent) if (!w[p].vis) return false;
        return true;
    };
    const abs = (n) => {
        let x = 0, y = 0;
        for (let p = n; p !== undefined && w[p] !== undefined; p = w[p].parent) {
            x += w[p].pos[0];
            y += w[p].pos[1];
        }
        return [x, y];
    };
    return { w, shown, abs };
}
```

In the session object, add after `messageId`:

```js
        /** Visible text widgets (ancestors included), top to bottom then left to right. */
        visibleTexts() {
            const { w, shown, abs } = widgetTree(calls);
            return Object.keys(w)
                .filter((n) => w[n].kind === "AddUIText" && w[n].msg !== undefined && shown(n))
                .map((n) => {
                    const [x, y] = abs(n);
                    return { name: n, parent: w[n].parent, msg: w[n].msg, x: x, y: y };
                })
                .sort((a, b) => a.y - b.y || a.x - b.x);
        },
        /** Clicks the nth visible text button (top to bottom) whose label key is `key`. */
        clickText(key, nth = 0) {
            const buttons = new Set(calls.filter((c) => c.name === "AddUIButton").map((c) => c.args[0]));
            const hits = session.visibleTexts().filter((t) => t.msg[0] === key && buttons.has(t.parent + "_b"));
            const hit = hits[nth];
            if (hit === undefined) throw new Error(`no visible button #${nth} labelled ${key} (${hits.length} found)`);
            M.OnPlayerUIButtonEvent(player, { widget: hit.parent + "_b" }, "UIButtonEvent.ButtonUp");
        },
```

- [ ] **Step 2: Write the failing save tests**

In `tools/test-tester.mjs`, add this helper next to `descOf`:

```js
/** The strings key music.gen.ts gave an event's name. */
function eventKey(name) {
    const m = new RegExp(`name: "${name}", event: [^,]+, key: "(\\w+)"`).exec(MUSIC_GEN);
    if (m === null) throw new Error(`music.gen.ts has no event ${name}`);
    return m[1];
}
/** Visible messages whose key is `key`, as JSON, top to bottom. */
function rowsWith(key) {
    return s.visibleTexts().filter((t) => t.msg[0] === key).map((t) => JSON.stringify(t.msg));
}
function check(phase, cond, what) {
    if (!cond) problems.push(`${phase}: ${what}`);
}
```

Then, directly before the line `// Back on a browser tab the tester must be gone and the browser back.`, insert:

```js
    // ---- Templates. Radio is loaded and on screen: channel 3 (Reggaeton), queue
    // [#1, #0] on channel 3, continue 1, loop 1, volume 1.
    await step("save radio", () => s.clickId("mtSave"));
    expect("save radio", []);
    expectSounds("save radio", ["MenuNavigation_Default_ToggleOn"]);
    check("save radio", notified("save radio").join() === labelKey("tplSaved"), `notifications ${JSON.stringify(notified("save radio"))}`);
    // The same setup again adds nothing and names the existing template.
    await step("save radio again", () => s.clickId("mtSave"));
    check("save radio again", notified("save radio again").join() === labelKey("tplExists"), `notifications ${JSON.stringify(notified("save radio again"))}`);

    // MUSIC still shows BR / BR_InsertionJump, lobby timer 10, volume 1.
    await step("tab music again", () => s.click("MUSIC"));
    await step("save music", () => s.clickId("mtSave"));
    check("save music", notified("save music").join() === labelKey("tplSaved"), "expected one tplSaved");

    await step("tab fav", () => s.click("FAVOURITES"));
    const radioRows = rowsWith(labelKey("tplRadioOf"));
    const musicRows = rowsWith(labelKey("tplMusicOf"));
    check("tab fav", radioRows.join() === JSON.stringify([labelKey("tplRadioOf"), 1, 2]), `radio template rows ${radioRows.join(" ; ")}`);
    check("tab fav", musicRows.join() === JSON.stringify([labelKey("tplMusicOf"), 2]), `music template rows ${musicRows.join(" ; ")}`);
    check("tab fav", rowsWith(eventKey("BR_InsertionJump")).length === 1, "music template row does not name BR_InsertionJump");
    check("tab fav", rowsWith(labelKey("radioCh3")).length >= 1, "radio template row does not name Reggaeton");
    check("tab fav", rowsWith(labelKey("kindRadio")).length === 1 && rowsWith(labelKey("kindMusic")).length === 1, "type badges");
    check("tab fav", rowsWith(labelKey("tplOpen")).length === 2, "two OPEN buttons");

    // A sound/effect filter hides templates; turning it off brings them back.
    await step("filter on", () => s.click("WORLD"));
    check("filter on", rowsWith(labelKey("tplOpen")).length === 0, "templates still listed under the WORLD filter");
    await step("filter off", () => s.click("WORLD"));
    check("filter off", rowsWith(labelKey("tplOpen")).length === 2, "templates did not come back");
```

`click("WORLD")` presses the WORLD filter chip, which the FAVOURITES tab shows (it uses the VFX chip set, `src/ui.ts` `buildChips`). If the replay throws "no widget is labelled", look up the chip labels FAVOURITES actually renders (`FILTERS.vfx` in `src/scene.gen.ts`) and use one of those. Keep the assertion.

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npm run gen && npm run bundle && node tools/test-tester.mjs`
Expected: FAIL, starting with `scene.json has no node "mtSave"` and `text.gen.ts has no label tplSaved`.

- [ ] **Step 4: Add the strings**

In `tools/gen-text.mjs` `STATIC`, after `mtQueueEmpty`:

```js
    // Template rows in FAVOURITES: type badge and the button that opens one.
    kindMusic: "MUSIC",
    kindRadio: "RADIO",
    tplOpen: "OPEN",
```

In `TEMPLATES`, after `mtLoadFirst`:

```js
    // Template rows' second line, and the SAVE TEMPLATE notifications.
    tplMusicOf: "MUSIC TEMPLATE {}",
    tplRadioOf: "RADIO TEMPLATE {} - {} tracks",
    // kind (MUSIC / RADIO), number.
    tplSaved: "Saved as {} TEMPLATE {}",
    tplExists: "Already saved as {} TEMPLATE {}",
```

After the `export const T` block is emitted (after `L.push("} as const;");` that closes T), emit the plain station names for EXPORT, from the same labels:

```js
L.push("");
L.push("/** Plain text of the radio stations, for log lines (EXPORT). Index = Radio_Channel / Radio_Biome. */");
L.push("export const RADIO_TEXT = {");
L.push("    channels: [" + [0, 1, 2, 3, 4, 5, 6].map((i) => q(STATIC["radioCh" + i])).join(", ") + "],");
L.push("    biomes: [" + [0, 1, 2, 3, 4, 5, 6].map((i) => q(STATIC["radioBiome" + i])).join(", ") + "],");
L.push("} as const;");
```

- [ ] **Step 5: Add the template model to `src/tester.ts`**

Change the import to `import { RADIO_TEXT, T, TPL } from "./text.gen";`.

Add to `TesterState`:

```ts
    /** Saved templates, in save order. Their keys ("tpl" + n) sit in the player's favourites. */
    templates: Template[];
    /** Number for the next template; never reused within a match. */
    nextTemplate: number;
```

In `newTesterState` add `templates: [], nextTemplate: 1` to the returned object.

After `queueLine`, add:

```ts
// ---- Templates: a saved setup of one tab, listed in FAVOURITES.

export interface MusicTemplate {
    kind: "music";
    n: number;
    /** MusicPackageSpec.name, e.g. "Core". */
    pkg: string;
    /** MusicEventSpec.name, e.g. "Core_LastPhaseBegin". */
    evt: string;
    /** Every param of the package, and its amplitude, by MusicParams name. */
    values: Record<string, number>;
}

export interface RadioTemplate {
    kind: "radio";
    n: number;
    /** Every Radio param except the queue param, and Radio_Amplitude. */
    values: Record<string, number>;
    /** The tracks queued since the last CLEAR QUEUE, in order. */
    queue: RadioPick[];
}

export type Template = MusicTemplate | RadioTemplate;

function capture(tab: TesterTab, st: TesterState): Template {
    const pkg = current(tab, st);
    const values: Record<string, number> = {};
    for (const p of pkg.params) if (!p.queues) values[p.name] = st.values[p.name];
    values[pkg.amp.name] = st.values[pkg.amp.name];
    if (tab === "radio") return { kind: "radio", n: 0, values: values, queue: st.queue.map((p) => ({ ch: p.ch, biome: p.biome, track: p.track })) };
    return { kind: "music", n: 0, pkg: pkg.name, evt: pkg.events[st.evt[st.pkg]].name, values: values };
}

/** Content only: two templates with the same signature are the same setup. */
function signature(t: Template): string {
    return JSON.stringify({ ...t, n: 0 });
}

/** Saves the tab's setup, unless an identical template exists (then returns that one). */
export function saveTemplate(tab: TesterTab, st: TesterState): { tpl: Template; added: boolean } {
    const t = capture(tab, st);
    const sig = signature(t);
    for (const old of st.templates) if (signature(old) === sig) return { tpl: old, added: false };
    t.n = st.nextTemplate++;
    st.templates.push(t);
    log("template: saved " + templateExportLine(t));
    return { tpl: t, added: true };
}

export function templateKey(t: Template): string {
    return "tpl" + t.n;
}

export function findTemplate(st: TesterState, key: string): Template | undefined {
    for (const t of st.templates) if (templateKey(t) === key) return t;
    return undefined;
}

function musicPkg(t: MusicTemplate): MusicPackageSpec {
    return pkgNamed(t.pkg);
}

function musicEvt(t: MusicTemplate): MusicEventSpec {
    for (const e of musicPkg(t).events) if (e.name === t.evt) return e;
    throw new Error("template event missing from music.gen.ts: " + t.evt);
}

/** The station a radio template is about: its first queued track, else its channel setting. */
function radioStation(t: RadioTemplate): { ch: number; biome: number } {
    const first = t.queue[0];
    if (first !== undefined) return first;
    return { ch: Math.round(t.values["Radio_Channel"] ?? 0), biome: Math.round(t.values["Radio_Biome"] ?? 0) };
}

function stationText(ch: number, biome: number): string {
    return (ch === 4 ? RADIO_TEXT.biomes[biome] : RADIO_TEXT.channels[ch]) ?? "?";
}

/** Plain-text name: the event, or the station. Used by search. */
export function templateName(t: Template): string {
    if (t.kind === "music") return t.evt;
    const s = radioStation(t);
    return stationText(s.ch, s.biome);
}

/** strings key of the row's name text. */
export function templateNameKey(t: Template): string {
    if (t.kind === "music") return musicEvt(t).key;
    const s = radioStation(t);
    return stationKey(s.ch, s.biome);
}

/** The row's second line. */
export function templateLine(t: Template): mod.Message {
    return t.kind === "music" ? mod.Message(TPL.tplMusicOf, t.n) : mod.Message(TPL.tplRadioOf, t.n, t.queue.length);
}

export function templateKindKey(t: Template): string {
    return t.kind === "music" ? T.kindMusic : T.kindRadio;
}
```

Task 4 implements `templateExportLine` properly. Add this stub now, because `saveTemplate` logs it:

```ts
export function templateExportLine(t: Template): string {
    return (t.kind === "music" ? "MUSIC" : "RADIO") + " TEMPLATE " + t.n;
}
```

- [ ] **Step 6: Add the `tpl` row kind to `src/ui.ts`**

Import: `import { findTemplate, templateKindKey, templateLine, templateName, templateNameKey, type Template } from "./tester";`. Merge it with the existing `./tester` import if there is one.

Row union:

```ts
export type Row =
    | { readonly type: "sfx"; readonly entry: SfxEntry }
    | { readonly type: "spawn"; readonly entry: VfxEntry }
    | { readonly type: "tpl"; readonly tpl: Template }
    | ScreenRow;
```

Update the helpers so they compile. A template has no catalog entry:

```ts
export function rowTextKey(r: Row): string {
    return r.type === "screen" ? r.key : r.type === "tpl" ? templateNameKey(r.tpl) : r.entry.key;
}

export function rowCatTextKey(r: Row): string {
    return r.type === "screen" ? r.catKey : r.type === "tpl" ? T.logEmpty : r.entry.catKey;
}

export function rowKey(r: Row): string {
    return r.type === "screen" ? "screen:" + r.id : r.type === "tpl" ? "tpl" + r.tpl.n : r.entry.name;
}

export function rowDisplay(r: Row): string {
    return r.type === "screen" ? r.display : r.type === "tpl" ? templateName(r.tpl) : r.entry.display;
}

export function rowCategory(r: Row): string {
    return r.type === "screen" ? r.category : r.type === "tpl" ? "Template" : r.entry.category;
}

export function rowRawName(r: Row): string {
    return r.type === "screen" ? r.display : r.type === "tpl" ? templateName(r.tpl) : r.entry.name;
}
```

`rowKey` returns `"tpl" + n`, which must equal `templateKey`. Inline it rather than importing, so it stays one expression like its neighbours.

In `matches`, add as the first line:

```ts
    // Templates are not sounds or effects: any sound/effect filter hides them.
    if (r.type === "tpl") return f.dim === "" && f.kind === "" && f.vfx === "";
```

In `favRows`, replace `const r = findRow(key);` with:

```ts
        const tpl = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
        const r: Row | undefined = tpl !== undefined ? { type: "tpl", tpl: tpl } : findRow(key);
```

Add the template row fields after `vfxRowFields`:

```ts
function tplRowFields(t: Template, selected: boolean): Scope {
    const badge = t.kind === "music" ? P.green : P.violet;
    return {
        bg: selected ? P.rowSel : P.row,
        name: K(templateNameKey(t)),
        nameColor: selected ? P.ink : P.inkDim,
        category: templateLine(t),
        favLabel: K(T.favRemove),
        favColor: P.amber,
        favBg: P.rowSel,
        stopLabel: K(T.stop),
        stopColor: P.inkDim,
        stopBg: P.panel,
        playLabel: K(T.play),
        playColor: "#FFFFFF",
        playBg: badge,
        actColor: "#FFFFFF",
        actBg: badge,
        b1: K(templateKindKey(t)),
        b1Color: badge,
        b1Bg: badge,
        b2: mod.Message(T.logEmpty),
        b2Color: P.row,
        b2Bg: P.row,
        selLabel: K(T.tplOpen),
        selColor: P.ink,
        selBg: P.row,
    };
}
```

At the top of `vfxRowFields`, next to the `sfx` early return, add:

```ts
    if (r.type === "tpl") return tplRowFields(r.tpl, selected);
```

Run `npx tsc --noEmit -p .`. Every remaining error is a place that reads `r.entry` without excluding `tpl`, for example in `src/index.ts` `preview()` and `exportFavourites`. Fix each by excluding `tpl` explicitly:
- `preview()` gets `if (r.type === "tpl") return;` as its first line. Template P is routed before `preview()` in Task 3.
- `exportFavourites` gets `if (r === undefined || r.type === "tpl") continue;`.

- [ ] **Step 7: Route `mtSave` in `src/index.ts`**

Imports:
- add `saveTemplate, templateKey, templateKindKey` to the `./tester` import;
- add `UI_SOUND` to the `./uisound` import, if it is not already imported.

In `handle()`, directly before the line `// MUSIC / RADIO buttons that need their package loaded are greyed out until`, insert:

```ts
    // SAVE TEMPLATE: the tab's setup into FAVOURITES. Never greyed out -- saving
    // sends nothing to the engine, so the package does not need to be loaded.
    if (action === "mtSave" && isTesterTab(ui.tab)) {
        const r = saveTemplate(ui.tab, ui.tester);
        if (r.added) ui.favourites.push(templateKey(r.tpl));
        playUiSound(ui.player, UI_SOUND.on);
        mod.DisplayNotificationMessage(mod.Message(r.added ? TPL.tplSaved : TPL.tplExists, templateKindKey(r.tpl), r.tpl.n), ui.player);
        defer(st);
        return;
    }
```

In `src/uisound.ts` `clickSound`, change the first line to:

```ts
    if (action === "mtPlay" || action === "mtSave" || /^r\d+_(play|fav)$/.test(action)) return undefined;
```

Also extend its doc comment: "SAVE TEMPLATE plays its own 'on' sound."

- [ ] **Step 8: Add the button to `src/scene.json`**

Run once with python (from the project root):

```python
import json
path = "src/scene.json"
scene = json.load(open(path, encoding="utf-8"))
nodes = scene["screen"]
byid = {n["id"]: n for n in nodes if "id" in n}
# LAST CALL read-out and its caption shrink to 448 wide (centre stays at x960).
byid["mtLast"]["w"] = 448
cap = next(n for n in nodes if n.get("text") == "The last call sent. The game cannot report what is playing.")
cap["w"] = 448
save = {"k": "textbutton", "y": 756, "w": 260, "h": 48, "textSize": 15, "textColor": "#FFFFFF", "bgAlpha": 1,
        "align": "Center", "fill": "Solid", "parent": "tester", "id": "mtSave", "x": 1194,
        "text": "SAVE TEMPLATE", "bg": "{{sh.blue}}"}
caption = {"k": "text", "textAlpha": 1, "align": "Center", "color": "{{sh.muted}}", "parent": "tester",
           "x": 1194, "y": 810, "w": 260, "h": 30, "text": "Saves to FAVOURITES.", "textSize": 12}
i = nodes.index(byid["mtLast"])
nodes[i + 1:i + 1] = [save, caption]
open(path, "w", encoding="utf-8", newline="").write(json.dumps(scene, indent=2, ensure_ascii=True) + "\n")
```

The mtLast caption is the node right after `mtLast` today. Inserting after `mtLast` puts the new nodes before that caption, which is fine because draw order does not overlap.

In `tools/gen-sandbox.mjs` nothing is bound for the new nodes (literal text, `sh` colours). Regenerate the preview in Step 10.

- [ ] **Step 9: Run the tests and make them pass**

Run: `npm run build`
Expected: exit 0. The `tester  :` line prints, and the batching peak stays under 100.

If `check:layout` reports an overlap, the caption under LAST CALL and the new caption share y810. They are 10 px apart horizontally (736+448=1184, then 1194). Keep it that way and adjust only what the gate names.

- [ ] **Step 10: Check the preview**

Run: `node tools/gen-sandbox.mjs`, then open `http://localhost:8081/?view=music` and `?view=radio` in the Browser pane (dev server `sfxvfx-preview`, from `.claude/launch.json`).
Expected: SAVE TEMPLATE sits between LAST CALL and FOR: ME. The LAST CALL text (`SetMusicParam(Radio_QueueTrackNumber, 2)` in the radio view) is not clipped. If it is, lower `mtLast` `textSize` until it fits, and re-run Step 9.

- [ ] **Step 11: Commit**

```bash
git add src/tester.ts src/ui.ts src/index.ts src/uisound.ts src/scene.json src/scene.gen.ts src/strings.json src/text.gen.ts tools/gen-text.mjs tools/ui-replay.mjs tools/test-tester.mjs preview/src/sandbox.js dist/bundle.ts dist/bundle.strings.json
git commit -m "Templates: SAVE TEMPLATE on MUSIC/RADIO, listed in FAVOURITES

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: OPEN, P, STOP and remove on template rows

**Files:**
- Modify: `src/tester.ts`, `src/index.ts`, `tools/test-tester.mjs`

**Interfaces:**
- Consumes: `Template`, `findTemplate`, `templateKey` (Task 2); `Row` kind `tpl` (Task 2); `needsLoad`-style notification (`TPL.mtLoadFirst`).
- Produces (in `src/tester.ts`):

  ```ts
  export function applyTemplate(st: TesterState, t: Template): TesterTab;
  export function playTemplate(st: TesterState, player: mod.Player, t: Template, redraw: () => void): void;
  /** undefined when STOP was sent; else the package that is not loaded. */
  export function stopTemplate(st: TesterState, player: mod.Player, t: Template): MusicPackageSpec | undefined;
  export function removeTemplate(st: TesterState, key: string): void;
  ```

- [ ] **Step 1: Write the failing tests**

In `tools/test-tester.mjs`, directly after the `filter off` check from Task 2, insert. Template 1 is the radio row (top) and template 2 the music row; rows are in save order.

```js
    // OPEN fills the tester and sends nothing. Change the MUSIC panel first so
    // the restore is visible: volume up, then the next package.
    await step("tab music change", () => s.click("MUSIC"));
    await step("vol up", () => s.clickId("mtVolUp"));
    await step("pkg next", () => s.clickId("mtPkgNext"));
    await step("tab fav 2", () => s.click("FAVOURITES"));
    await step("open music", () => s.clickText(labelKey("tplOpen"), 1));
    expect("open music", []);
    shows("open music", "mtEventDesc", () => descOf("BR_InsertionJump"));
    showsMsg("open music", "mtVol", () => [labelKey("num1"), 1]);

    // OPEN on the radio template leaves the queue read-out alone.
    await step("tab fav 3", () => s.click("FAVOURITES"));
    await step("open radio", () => s.clickText(labelKey("tplOpen"), 0));
    expect("open radio", []);
    showsMsg("open radio", "mtEventIdx", () => [labelKey("mtQueueCount"), 2, labelKey("radioCh3"), 0]);

    // P on the music template: BR is not loaded, so it loads it (unloading Radio),
    // holds, then sends what PLAY sends.
    await step("tab fav 4", () => s.click("FAVOURITES"));
    await step("play music tpl", () => s.clickText(labelKey("play"), 1));
    expect("play music tpl", ["UnloadMusic(MusicPackages.Radio)", "LoadMusic(MusicPackages.BR)"]);
    await wait("music tpl plays", LOAD_MS + 600);
    expect("music tpl plays", [
        "SetMusicParam(MusicParams.BRGauntlet_LobbyTimerRemaining, 10, player)",
        "SetMusicParam(MusicParams.BR_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.BR_InsertionJump, player)",
    ]);

    // STOP on the radio template while BR is loaded: nothing sent, notification.
    await step("stop radio tpl unloaded", () => s.clickText(labelKey("stop"), 0));
    expect("stop radio tpl unloaded", []);
    check("stop radio tpl unloaded", notified("stop radio tpl unloaded").join() === labelKey("mtLoadFirst"), "expected one mtLoadFirst");

    // P on the radio template: load Radio, then clear, re-queue, settings, play.
    await step("play radio tpl", () => s.clickText(labelKey("play"), 0));
    expect("play radio tpl", ["UnloadMusic(MusicPackages.BR)", "LoadMusic(MusicPackages.Radio)"]);
    await wait("radio tpl plays", LOAD_MS + 600);
    expect("radio tpl plays", [
        "PlayMusic(MusicEvents.Radio_ClearQueue, player)",
        "SetMusicParam(MusicParams.Radio_Channel, 3, player)",
        "SetMusicParam(MusicParams.Radio_Biome, 0, player)",
        "SetMusicParam(MusicParams.Radio_QueueTrackNumber, 1, player)",
        "SetMusicParam(MusicParams.Radio_QueueTrackNumber, 0, player)",
        "SetMusicParam(MusicParams.Radio_Biome, 0, player)",
        "SetMusicParam(MusicParams.Radio_Channel, 3, player)",
        "SetMusicParam(MusicParams.Radio_ContinueQueueOnTrackEnd, 1, player)",
        "SetMusicParam(MusicParams.Radio_LoopQueuedTracks, 1, player)",
        "SetMusicParam(MusicParams.Radio_Amplitude, 1, player)",
        "PlayMusic(MusicEvents.Radio_Play, player)",
    ]);
    await step("stop radio tpl", () => s.clickText(labelKey("stop"), 0));
    expect("stop radio tpl", ["PlayMusic(MusicEvents.Radio_Stop, player)"]);
```

If the `shows`/`showsMsg` helpers cannot find `mtVol` because it is not a top-level scene node, `messageId` throws with the node name. In that case drop the `mtVol` line, and assert the volume through the `music tpl plays` expectation instead (`BR_Amplitude, 1`), which already covers it.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm run gen && npm run bundle && node tools/test-tester.mjs`
Expected: FAIL. `open music` reports `UNHANDLED`, or the wrong `mtEventDesc`, and `play music tpl` gets no Load calls.

- [ ] **Step 3: Implement apply, play, stop and remove in `src/tester.ts`**

First, pull PLAY's body out of `handleTesterAction` so templates reuse it. Replace:

```ts
    if (action === "mtPlay") {
        // Re-send everything first, so what plays always matches the panel. The
        // queue param is the exception: re-sending it would queue another track.
        const e = radio ? RADIO_PLAY : pkg.events[st.evt[st.pkg]];
        whenLoaded(() => {
            for (const p of pkg.params) if (!p.queues) sendParam(player, st, p);
            sendParam(player, st, pkg.amp);
            sendEvent(player, st, e.event, e.name, e.key);
            redraw();
        });
        return true;
    }
```

with:

```ts
    if (action === "mtPlay") {
        whenLoaded(() => {
            sendPlay(tab, st, player);
            redraw();
        });
        return true;
    }
```

and add, before `handleTesterAction`:

```ts
/**
 * What PLAY sends. Re-send everything first, so what plays always matches the
 * panel. The queue param is the exception: re-sending it would queue another track.
 */
function sendPlay(tab: TesterTab, st: TesterState, player: mod.Player): void {
    const pkg = current(tab, st);
    const e = tab === "radio" ? RADIO_PLAY : pkg.events[st.evt[st.pkg]];
    for (const p of pkg.params) if (!p.queues) sendParam(player, st, p);
    sendParam(player, st, pkg.amp);
    sendEvent(player, st, e.event, e.name, e.key);
}
```

Then, after `templateKindKey`, add:

```ts
function templatePkg(t: Template): MusicPackageSpec {
    return t.kind === "music" ? musicPkg(t) : RADIO;
}

/**
 * Puts the template into the panel and returns the tab to show. Sends nothing:
 * OPEN is for looking and tweaking. The radio queue state is left alone, because
 * it records what the engine has queued, and OPEN queues nothing.
 */
export function applyTemplate(st: TesterState, t: Template): TesterTab {
    for (const name of Object.keys(t.values)) st.values[name] = t.values[name];
    if (t.kind === "radio") return "radio";
    const pkg = musicPkg(t);
    st.pkg = MUSIC_TAB.indexOf(pkg);
    st.evt[st.pkg] = pkg.events.indexOf(musicEvt(t));
    return "music";
}

/**
 * P on a template row: apply it, LOAD its package if another one is loaded, then
 * play. A radio template rebuilds the queue first -- clear, then for each track
 * its channel and biome (when they change) and its number -- because the queue
 * is what Radio_Play plays.
 */
export function playTemplate(st: TesterState, player: mod.Player, t: Template, redraw: () => void): void {
    const tab = applyTemplate(st, t);
    const pkg = templatePkg(t);
    if (loaded !== pkg) load(st, pkg, redraw);
    whenLoaded(() => {
        if (t.kind === "radio") requeue(st, player, t);
        sendPlay(tab, st, player);
        redraw();
    });
}

function requeue(st: TesterState, player: mod.Player, t: RadioTemplate): void {
    const q = queueParam(RADIO);
    const channel = paramNamed(RADIO, "Radio_Channel");
    const biome = paramNamed(RADIO, "Radio_Biome");
    if (q === undefined) return;
    sendEvent(player, st, RADIO_CLEAR.event, RADIO_CLEAR.name, RADIO_CLEAR.key);
    st.queue = [];
    let ch = -1;
    let bi = -1;
    for (const pick of t.queue) {
        if (pick.ch !== ch) {
            st.values[channel.name] = pick.ch;
            sendParam(player, st, channel);
            ch = pick.ch;
        }
        if (pick.biome !== bi) {
            st.values[biome.name] = pick.biome;
            sendParam(player, st, biome);
            bi = pick.biome;
        }
        st.values[q.name] = pick.track;
        sendParam(player, st, q);
        noteQueued(st, q);
    }
    // The saved settings, not the last track's station, are what PLAY re-sends.
    for (const name of Object.keys(t.values)) st.values[name] = t.values[name];
}

function paramNamed(pkg: MusicPackageSpec, name: string): MusicParamSpec {
    for (const p of pkg.params) if (p.name === name) return p;
    throw new Error("param missing from music.gen.ts: " + name);
}

/** STOP on a template row. Returns the package when it is not loaded (nothing is sent). */
export function stopTemplate(st: TesterState, player: mod.Player, t: Template): MusicPackageSpec | undefined {
    const pkg = templatePkg(t);
    if (loaded !== pkg) return pkg;
    whenLoaded(() => sendEvent(player, st, pkg.stop, pkg.name + "_Stop", pkg.stopKey));
    return undefined;
}

export function removeTemplate(st: TesterState, key: string): void {
    st.templates = st.templates.filter((t) => templateKey(t) !== key);
    log("template: removed " + key);
}
```

`RADIO_CLEAR` and `RADIO_PLAY` are `MusicEventSpec`s defined near the top of the file, and `load` and `whenLoaded` already exist.

- [ ] **Step 4: Route the template row buttons in `src/index.ts`**

Add `applyTemplate, playTemplate, removeTemplate, stopTemplate` to the `./tester` import.

In the row-action block, directly after `const key = rowKey(item);`, insert:

```ts
        if (item.type === "tpl") {
            const t = item.tpl;
            if (tag === "sel") {
                ui.tab = applyTemplate(ui.tester, t);
                ui.selectedKey = "";
                defer(st);
                return;
            }
            if (tag === "play") {
                playTemplate(ui.tester, ui.player, t, () => defer(st));
                defer(st);
                return;
            }
            if (tag === "stop") {
                const unloaded = stopTemplate(ui.tester, ui.player, t);
                if (unloaded !== undefined) {
                    playUiSound(ui.player, UI_SOUND.denied);
                    mod.DisplayNotificationMessage(mod.Message(TPL.mtLoadFirst, unloaded.key, unloaded.key), ui.player);
                }
                defer(st);
                return;
            }
            if (tag === "fav") {
                ui.favourites.splice(ui.favourites.indexOf(key), 1);
                removeTemplate(ui.tester, key);
                playUiSound(ui.player, UI_SOUND.off);
                defer(st);
                return;
            }
        }
```

`clickSound` already plays the generic click for `r<i>_sel` and `r<i>_stop` before routing. For a denied STOP the player hears the click and then the denied sound. That's acceptable and matches how blocked tester buttons sound. Do not add more.

- [ ] **Step 5: Add the removal test, then run everything**

Append after the `stop radio tpl` step:

```js
    // The fav button on a template row removes it.
    await step("remove radio tpl", () => s.clickText(labelKey("favRemove"), 0));
    expectSounds("remove radio tpl", ["MenuNavigation_Default_ToggleOff"]);
    check("remove radio tpl", rowsWith(labelKey("tplRadioOf")).length === 0, "radio template still listed");
    check("remove radio tpl", rowsWith(labelKey("tplMusicOf")).length === 1, "music template gone too");
```

Run: `npm run build`
Expected: exit 0.

Then a mutation check: in `src/tester.ts` `applyTemplate`, temporarily delete the `st.evt[...]` line, then run `npm run bundle && node tools/test-tester.mjs`.
Expected: FAIL at `open music`.
Restore the line, and run `npm run build` again to get exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/tester.ts src/index.ts tools/test-tester.mjs dist/bundle.ts dist/bundle.strings.json
git commit -m "Templates: OPEN, play, stop and remove from FAVOURITES

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: EXPORT lines, mixed-station queues, docs

**Files:**
- Modify: `src/tester.ts` (`templateExportLine`), `src/index.ts` (`exportFavourites`), `tools/test-tester.mjs`, `description.md`

**Interfaces:**
- Consumes: `Template`, `findTemplate`, `RADIO_TEXT` (Task 2).
- Produces: `templateExportLine(t: Template): string`, the full line.

- [ ] **Step 1: Write the failing tests**

Append after the `remove radio tpl` checks. At this point:
- Radio is loaded and the radio panel is channel 3, with the queue [#1, #0] on channel 3 (rebuilt by P), and the queue number advanced to 1.
- The music template 2 (BR) remains.

```js
    // A mixed-station queue: add a BF Themes (channel 2) track on top of the two
    // Reggaeton ones, then save. EXPORT names each track's station.
    await step("tab radio mix", () => s.click("RADIO"));
    await step("channel down", () => s.clickId("mtP1Down"));
    await step("queue mixed", () => s.clickId("mtQueue"));
    expect("queue mixed", ["SetMusicParam(MusicParams.Radio_QueueTrackNumber, 1, player)"]);
    await step("save mixed", () => s.clickId("mtSave"));
    check("save mixed", notified("save mixed").join() === labelKey("tplSaved"), "expected tplSaved");

    await step("tab fav export", () => s.click("FAVOURITES"));
    await step("export", () => s.click("EXPORT FAVOURITES"));
    const lines = [
        "MUSIC TEMPLATE 2 | BR | BR_InsertionJump | BRGauntlet_LobbyTimerRemaining 10 | volume 1",
        "RADIO TEMPLATE 3 | channel 2 BF Themes | queue Reggaeton #1, Reggaeton #0, BF Themes #1 | continue 1, loop 1 | volume 1",
    ];
    for (const l of lines) check("export", s.logs.some((x) => x.endsWith(l)), `missing export line: ${l}\n        got: ${s.logs.filter((x) => /TEMPLATE/.test(x)).join("\n             ")}`);
```

Add one model-level check that needs no UI: a Gauntlet template (no params) exports `no params`. Gauntlet is MUSIC package 3, and its default track is `Gauntlet_Deploy`. Save it after one more `mtPkgNext` from BR:

```js
    await step("tab music g", () => s.click("MUSIC"));
    await step("pkg to gauntlet", () => s.clickId("mtPkgNext"));
    await step("save gauntlet", () => s.clickId("mtSave"));
    await step("tab fav export 2", () => s.click("FAVOURITES"));
    await step("export 2", () => s.click("EXPORT FAVOURITES"));
    check("export 2", s.logs.some((x) => x.endsWith("MUSIC TEMPLATE 4 | Gauntlet | Gauntlet_Deploy | no params | volume 1")), "missing Gauntlet export line");
```

The music panel was restored to BR by OPEN in Task 3, so one `mtPkgNext` reaches Gauntlet. If the test reports a different package, read the `tester` log lines for the package actually on screen before changing anything.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm run gen && npm run bundle && node tools/test-tester.mjs`
Expected: FAIL with `missing export line` (export does not write templates yet, and the stub has no details).

- [ ] **Step 3: Implement the export line**

Replace the stub `templateExportLine` in `src/tester.ts` with:

```ts
/**
 * One plain-text line for EXPORT: names and values only, not code. A radio queue
 * names each track's station when any track is not on the template's own station.
 */
export function templateExportLine(t: Template): string {
    if (t.kind === "music") {
        const pkg = musicPkg(t);
        const params = pkg.params.map((p) => p.name + " " + t.values[p.name]).join(", ");
        return "MUSIC TEMPLATE " + t.n + " | " + pkg.name + " | " + t.evt + " | " + (params === "" ? "no params" : params) + " | volume " + t.values[pkg.amp.name];
    }
    const ch = Math.round(t.values["Radio_Channel"] ?? 0);
    const biome = Math.round(t.values["Radio_Biome"] ?? 0);
    const own = (p: RadioPick) => p.ch === ch && (ch !== 4 || p.biome === biome);
    const mixed = t.queue.some((p) => !own(p));
    const queue = t.queue.length === 0 ? "queue empty" : "queue " + t.queue.map((p) => (mixed ? stationText(p.ch, p.biome) + " " : "") + "#" + p.track).join(", ");
    return (
        "RADIO TEMPLATE " + t.n +
        " | channel " + ch + " " + stationText(ch, biome) +
        " | " + queue +
        " | continue " + t.values["Radio_ContinueQueueOnTrackEnd"] + ", loop " + t.values["Radio_LoopQueuedTracks"] +
        " | volume " + t.values["Radio_Amplitude"]
    );
}
```

In `src/index.ts`:
- add `findTemplate, templateExportLine` to the `./tester` import;
- in `exportFavourites`, after the sounds and effects loop and before `logAlways("---- END FAVOURITES ----");`, add:

```ts
    // Templates after the assets, in save order: plain names and values, not code.
    for (const key of ui.favourites) {
        const t = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
        if (t !== undefined) logAlways(templateExportLine(t));
    }
```

The header count and the `exportedN` notification already use `ui.favourites.length`, which includes template keys.

- [ ] **Step 4: Run everything**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Document it**

In `description.md` `## Favourites` section, append:

```markdown
**Music and radio templates.** On the MUSIC or RADIO tab, `SAVE TEMPLATE` saves the setup on screen to FAVOURITES:
- MUSIC: the package, track, every parameter and the volume;
- RADIO: the station settings, the volume and the tracks you queued since the last `CLEAR QUEUE`.

Saving the same setup twice keeps one copy. In FAVOURITES, a template row shows the track or station and its number:
- `OPEN` puts it back into the tester;
- `P` loads the package if needed and plays it (a radio template re-queues its tracks first);
- `STOP` stops it;
- `*` removes it.

`EXPORT FAVOURITES` writes each template as one plain line of names and values. Templates last for the match, like the rest of your favourites.
```

- [ ] **Step 6: Final checks and commit**

Run: `npm run build` (exit 0), then `node tools/gen-sandbox.mjs`. In the preview, check the music and radio views for overlap or clipping.

```bash
git add src/tester.ts src/index.ts tools/test-tester.mjs description.md preview/src/sandbox.js dist/bundle.ts dist/bundle.strings.json
git commit -m "Templates: EXPORT as plain lines; document templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Visible controller highlight on every browser button

Independent of Tasks 1-4. It can run first.

**Problem (user report, 2026-10-01).** With a controller, the focused button on the SOUND / VISUAL / FAVOURITES tabs is barely visible: the buttons look grey and the highlight only turns the text white. On MUSIC / RADIO and on the search keyboard, the highlight is a clear orange.

**Cause.**
- Every button already gets the same orange (`P.hot`) for focus and press (`buttonPalette` in `src/ui.ts`).
- The difference is the fill:
  - MUSIC / RADIO buttons, the filter chips and the keyboard keys are `fill: "Solid"`;
  - every other scene button is `fill: "None"`. That covers the 5 tabs, CLOSE, SELECT/EXPORT, DEBUG, the pagers, the amplitude/range/scale steppers, STOP ALL, UNDO, DELETE ALL, the rail rows and pager, and the row buttons fav/P/STOP/SELECT.
- With no fill, the engine draws a default grey button, so neither the button's own colour nor the orange focus colour shows. Only the label turning white is left.

**Fix.**
- Make every button `fill: "Solid"`, as the working ones already are. Each button then shows its own `bg` colour, the ones `scene.json` already gives it (for example `orangeDim` steppers, a red CLOSE, the tab colours), and turns orange when focused.
- Add an invariant so a `None` button cannot come back.
- MUSIC / RADIO are unchanged.

**Files:**
- Modify: `src/scene.json` (the 26 button nodes listed by the gate in Step 2)
- Modify: `tools/check-invariants.mjs` (new invariant E)

**Interfaces:** none. This is presentation only, with no new fields or actions.

- [ ] **Step 1: Write the failing invariant**

In `tools/check-invariants.mjs`, before `if (problems.length > 0) {`, add:

```js
// ---- E. every button is drawn with a solid fill
// A button with fill "None" renders as the engine's default grey and never shows
// its focused colour, so a controller user cannot see which button is selected
// (2026-10-01). MUSIC / RADIO, the chips and the keyboard were already Solid and
// highlight in orange; everything else was None.
const sceneJson = JSON.parse(readFileSync(resolve(ROOT, "src", "scene.json"), "utf8"));
const unfilled = [];
(function walk(o, where) {
    if (Array.isArray(o)) {
        for (const v of o) walk(v, where);
        return;
    }
    if (o === null || typeof o !== "object") return;
    if ((o.k === "textbutton" || o.k === "button") && o.fill !== "Solid") unfilled.push(where + ":" + (o.id ?? o.text));
    for (const [k, v] of Object.entries(o)) walk(v, k === "screen" ? "screen" : where === "" ? k : where);
})(sceneJson, "");
for (const m of ui.matchAll(/\{\s*k:\s*"textbutton"[^}]*\}/g)) {
    if (!/fill:\s*"Solid"/.test(m[0])) unfilled.push("ui.ts:" + m[0].slice(0, 60));
}
if (unfilled.length > 0) {
    problems.push(`buttons without fill "Solid" (no visible controller highlight): ${unfilled.join(", ")}`);
}
```

Also extend the final `console.log` summary with `", every button solid-filled"`.

- [ ] **Step 2: Run the gate and confirm it fails**

Run: `node tools/check-invariants.mjs`
Expected: FAIL with `buttons without fill "Solid"`, listing `tabSfx`, `btnClose`, ..., `fav`, `play`, `stop`, `sel`, `btnRailPrev`, `btnRailNext` and `railRow`. That is 26 entries, and none of them starts with `mt`.

- [ ] **Step 3: Fill them**

Run once, from the project root:

```python
import json
path = "src/scene.json"
scene = json.load(open(path, encoding="utf-8"))
n = 0
def walk(o):
    global n
    if isinstance(o, list):
        for v in o: walk(v)
    elif isinstance(o, dict):
        if o.get("k") in ("textbutton", "button") and o.get("fill") != "Solid":
            o["fill"] = "Solid"
            n += 1
        for v in o.values(): walk(v)
walk(scene)
open(path, "w", encoding="utf-8", newline="").write(json.dumps(scene, indent=2, ensure_ascii=True) + "\n")
print(n, "buttons now Solid")
```

Expected output: `26 buttons now Solid`. If the count differs, compare it with the Step 2 list before going on.

- [ ] **Step 4: Run the full gate**

Run: `npm run build`
Expected: exit 0, with the invariants line ending in `every button solid-filled`. Batching is unchanged, because no widgets are added.

- [ ] **Step 5: Check the preview**

Run `node tools/gen-sandbox.mjs`. In the Browser pane, open `http://localhost:8081/?view=sfx`, `?view=vfx`, `?view=grouped`, `?view=selected` and `?view=armed`.
Expected:
- every button shows a solid fill in its scene colour;
- every label is readable on its fill, including the text on `orangeDim` and `row` fills;
- no button blends into its row so much that it can't be found.

If a label is unreadable, change that node's `textColor` in `scene.json`, never its fill. Re-run Step 4.

Focus can't be seen in the preview. The user checks the orange highlight in game with a controller.

- [ ] **Step 6: Commit**

```bash
git add src/scene.json src/scene.gen.ts tools/check-invariants.mjs preview/src/sandbox.js dist/bundle.ts dist/bundle.strings.json
git commit -m "UI: solid-fill every button so the controller highlight shows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
