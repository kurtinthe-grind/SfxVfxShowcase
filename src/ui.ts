// Tabbed asset browser: two tabs, a group rail, filter chips, a simulated QWERTY
// search keyboard with a clickable prefix page, and per-tab parameter footers.
// Renders src/scene.json (generated into scene.gen.ts) for the shipping mod;
// tools/gen-sandbox.mjs renders the SAME scene data for a browser preview, so
// geometry and palette cannot drift. That preview is LAYOUT-ONLY: it has no
// mod.Message and no widget layer, so it cannot validate anything about the
// Portal UI itself.
//
// Portal has NO keyboard or text-input API - the only UI event is
// OnPlayerUIButtonEvent - so the search field is necessarily a grid of ordinary
// UI buttons that append to a query string.
//
// WIDGETS ARE bf6-portal-utils/ui, NOT hand-rolled mod.AddUI*.
//
// This file used to call mod.AddUIContainer / AddUIText / AddUIButton /
// SetUITextLabel directly, and that was wrong three times over:
//
//   * AddUIButton's overloads take no message and SetUITextLabel is for text
//     widgets, so every button label rendered blank;
//   * the container was positioned at (0,0) while its children sat at absolute
//     coordinates, a malformed tree that drew correctly but was never hit-tested;
//   * clicks were routed by parsing widget names against a private
//     "w<playerId>_<action>" scheme, while mod.GetUIWidgetName on a button is not
//     something this code controls.
//
// AGENT.md 2.4 and 4.2 require the vetted utils. UIContainer / UIText /
// UITextButton own widget creation, naming, input-mode reference counting and
// click routing; this file owns layout, state and content. Buttons carry an
// onClickUp closure instead of a name lookup.
//
// The UI core is a Structure-of-Arrays with dirty flags, generational slot
// recycling and a coalesced UI.flush() on OnTickEnd. That machinery exists so
// properties can be MUTATED rather than widgets recreated, so elements are
// allocated once (lazily, per group) and then updated in place. The browser
// preview still rebuilds each frame; the two differ deliberately.

import { CATEGORY_TEXT as CAT_TEXT, SFX_CATALOG, SFX_PREFIXES, VFX_CATALOG, VFX_PREFIXES, type PrefixEntry, type SfxEntry, type VfxEntry } from "./catalog";
import { FILTERS, GRID, KEYBOARD, PALETTE, RAIL, RAIL_PAGER, RAIL_ROW, ROW, SCREEN, type SceneNode } from "./scene.gen";
import { CHAR_KEY, SCENE_TEXT, T, TPL } from "./text.gen";
import { debugEnabled, log, reportMissingKey } from "./diag";
import { findTemplate, templateKindKey, templateLine, templateName, templateNameKey, testerFields, type Template, type TesterState } from "./tester";
import { UI } from "bf6-portal-utils/ui";
import { UIContainer } from "bf6-portal-utils/ui/components/container";
import { UIText } from "bf6-portal-utils/ui/components/text";
import { UITextButton } from "bf6-portal-utils/ui/components/text-button";

// ---------------------------------------------------------------------------
// Text plumbing. Portal's mod.Message() is a lookup into strings.json, not a
// formatter: mod.Message("SOUND") prints <unknown string> because "SOUND" is not
// a key in that file. Arguments have to be keys as well (numbers are passed raw),
// so composed text is assembled from key strings and only becomes a Message at the
// point it reaches the UI.
// ---------------------------------------------------------------------------
export type Text = string | mod.Message;

export function K(key: string): mod.Message {
    return mod.Message(key);
}

export function S(lit: string): mod.Message {
    const key = SCENE_TEXT[lit];
    if (key === undefined) {
        reportMissingKey(lit, "scene literal");
        return mod.Message(T.logBadMessage);
    }
    return mod.Message(key);
}

export function charKey(ch: string): string | undefined {
    return CHAR_KEY[ch];
}

export function msgFor(t: string | number | mod.Message): mod.Message {
    if (typeof t === "number") return mod.Message(TPL.num1, t);
    if (typeof t !== "string") return t;
    const scene = SCENE_TEXT[t];
    if (scene !== undefined) return mod.Message(scene);
    const curated = (T as Record<string, string>)[t];
    if (curated !== undefined) return mod.Message(curated);
    reportMissingKey(t, "field or node text");
    return mod.Message(T.logBadMessage);
}

export function rowTextKey(r: Row): string {
    return r.type === "screen" ? r.key : r.type === "tpl" ? templateNameKey(r.tpl) : r.entry.key;
}

export function rowCatTextKey(r: Row): string {
    return r.type === "screen" ? r.catKey : r.type === "tpl" ? T.logEmpty : r.entry.catKey;
}

type WidgetSpec = Omit<SceneNode, "text"> & { readonly text?: string | mod.Message };

type WidgetNode = SceneNode | WidgetSpec;

export type Scope = Record<string, string | number | mod.Message>;
export type Fields = Record<string, Scope>;

const P = PALETTE as Record<string, string>;

export type Tab = "sfx" | "vfx" | "fav" | "music" | "radio";

/** MUSIC and RADIO are the tester tabs: no rail, list, chips or keyboard. */
export function isTesterTab(tab: Tab): tab is "music" | "radio" {
    return tab === "music" || tab === "radio";
}

export type ScreenRow = { readonly type: "screen"; readonly id: string; readonly display: string; readonly category: string; readonly key: string; readonly catKey: string };

export type Row =
    | { readonly type: "sfx"; readonly entry: SfxEntry }
    | { readonly type: "spawn"; readonly entry: VfxEntry }
    | { readonly type: "tpl"; readonly tpl: Template }
    | ScreenRow;

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

export interface FilterState {
    query: string;
    dim: string;
    kind: string;
    vfx: string;
}

export const NO_FILTERS: FilterState = { query: "", dim: "", kind: "", vfx: "" };

export const MAX_QUERY = 24;

function matches(r: Row, tab: Tab, f: FilterState): boolean {
    // Templates are not sounds or effects, and FAVOURITES shows no filter chips,
    // so a filter left on in SOUND or VISUAL must not hide them.
    if (r.type === "tpl") return true;
    if (tab === "sfx") {
        if (r.type !== "sfx") return false;
        if (f.dim !== "" && r.entry.dim !== f.dim) return false;
        if (f.kind !== "" && r.entry.kind !== f.kind) return false;
    } else {
        if (f.vfx === "world" && r.type !== "spawn") return false;
        if (f.vfx === "screen" && r.type !== "screen") return false;
    }
    return true;
}

function matchesQuery(r: Row, q: string): boolean {
    if (q === "") return true;
    const needle = q.toLowerCase();
    return rowDisplay(r).toLowerCase().indexOf(needle) >= 0 || rowRawName(r).toLowerCase().indexOf(needle) >= 0;
}

/**
 * Colour conversion for bf6-portal-utils/ui, whose UI.Color is a plain
 * { r, g, b } rather than an opaque mod.Vector. scene.json stores hex so the
 * preview and the mod read one source; this is the only conversion point.
 */
const rgbCache: Record<string, UI.Color> = {};

export function rgb(hex: string): UI.Color {
    let c = rgbCache[hex];
    if (c === undefined) {
        const n = parseInt(hex.slice(1), 16);
        c = { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
        rgbCache[hex] = c;
    }
    return c;
}

function scaleRgb(c: UI.Color, k: number): UI.Color {
    return { r: Math.min(1, c.r * k), g: Math.min(1, c.g * k), b: Math.min(1, c.b * k) };
}


interface RgbPalette {
    base: UI.Color;
    disabled: UI.Color;
    pressed: UI.Color;
    hover: UI.Color;
    focused: UI.Color;
}
const buttonCache: Record<string, RgbPalette> = {};

function buttonPalette(hex: string): RgbPalette {
    let p = buttonCache[hex];
    if (p === undefined) {
        const base = rgb(hex);
        p = {
            base: base,
            disabled: scaleRgb(base, 0.5),
            // Both interactive states are the same saturated orange, and neither
            // is derived from the base. Scaling a near-black base by 0.75 made
            // press look like a shadow, and scaling it by 1.15 made cursor-over
            // look like nothing, which is why the highlight never registered on
            // the keyboard keys, the prefix tiles or the small steppers.
            pressed: rgb(P.hot),
            hover: rgb(P.hot),
            focused: rgb(P.hot),
        };
        buttonCache[hex] = p;
    }
    return p;
}

const FILL_CACHE: Record<string, UI.BgFill> = {};

function uiFill(name: string | undefined): UI.BgFill {
    const key = name ?? "None";
    let v = FILL_CACHE[key];
    if (v === undefined) {
        switch (key) {
            case "Solid": v = UI.BgFill.Solid; break;
            case "Blur": v = UI.BgFill.Blur; break;
            case "OutlineThin": v = UI.BgFill.OutlineThin; break;
            case "OutlineThick": v = UI.BgFill.OutlineThick; break;
            case "GradientBottom": v = UI.BgFill.GradientBottom; break;
            case "GradientTop": v = UI.BgFill.GradientTop; break;
            case "GradientLeft": v = UI.BgFill.GradientLeft; break;
            case "GradientRight": v = UI.BgFill.GradientRight; break;
            default: v = UI.BgFill.None;
        }
        FILL_CACHE[key] = v;
    }
    return v;
}

const ANCHOR_CACHE: Record<string, UI.Anchor> = {};

function uiAnchor(name: string | undefined): UI.Anchor {
    const key = name ?? "Center";
    let v = ANCHOR_CACHE[key];
    if (v === undefined) {
        switch (key) {
            case "Left": case "CenterLeft": v = UI.Anchor.CenterLeft; break;
            case "Right": case "CenterRight": v = UI.Anchor.CenterRight; break;
            case "TopLeft": v = UI.Anchor.TopLeft; break;
            case "TopRight": v = UI.Anchor.TopRight; break;
            case "TopCenter": v = UI.Anchor.TopCenter; break;
            case "BottomCenter": v = UI.Anchor.BottomCenter; break;
            case "BottomLeft": v = UI.Anchor.BottomLeft; break;
            case "BottomRight": v = UI.Anchor.BottomRight; break;
            default: v = UI.Anchor.Center;
        }
        ANCHOR_CACHE[key] = v;
    }
    return v;
}

function resolveToken(tok: string, fields: Fields): string | number | mod.Message {
    const body = tok.slice(2, tok.length - 2);
    const dot = body.indexOf(".");
    if (dot < 0) return body;
    const g = fields[body.slice(0, dot)];
    if (g === undefined) return body;
    const v = g[body.slice(dot + 1)];
    // Returned untouched. A field can hold a mod.Message, and String() on an opaque
    // Message gives "[object Object]", which msgFor() cannot resolve to a key.
    return v === undefined ? body : v;
}

function prop(n: WidgetNode, key: string, fields: Fields, scope: string): string | number | mod.Message | undefined {
    return rawProp(n, key, fields, scope);
}

function propStr(n: WidgetNode, key: string, fields: Fields, scope: string): string | undefined {
    const v = rawProp(n, key, fields, scope);
    return typeof v === "string" ? v : v === undefined ? undefined : String(v);
}

function rawProp(n: WidgetNode, key: string, fields: Fields, scope: string): string | number | mod.Message | undefined {
    const binds = n.bind;
    if (binds !== undefined) {
        const bound = binds[key];
        if (bound !== undefined) {
            const s = fields[scope];
            if (s !== undefined) {
                const v = s[bound];
                if (v !== undefined) return v;
            }
        }
    }
    const raw = (n as unknown as Record<string, unknown>)[key];
    if (raw === undefined) return undefined;
    if (typeof raw === "string" && raw.startsWith("{{")) return resolveToken(raw, fields);
    // Returned as-is. An inline spec can carry a mod.Message directly (the filter
    // chips, SEARCH, the keyboard), and String() on an opaque Message gives
    // "[object Object]", which msgFor() cannot resolve to a key.
    return raw as string | number | mod.Message;
}

export function truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + "...";
}

let SFX_GROUPS: string[] = [];
let EXTRA_CAT_KEYS: Record<string, string> = {};
let VFX_GROUPS: string[] = [];
let SCREEN_ROWS: ScreenRow[] = [];

export function registerGroups(sfxGroups: string[], vfxGroups: string[], screenRows: ScreenRow[]): void {
    SFX_GROUPS = sfxGroups;
    // Screen-effect rows carry their own categories (Gas, Screen). Fold them in at
    // the FRONT of the VFX group list: otherwise VL7 is only reachable by paging
    // through ALL, and the rail can only show a slice of the groups anyway.
    const merged: string[] = [];
    for (const r of screenRows) if (merged.indexOf(r.category) < 0) merged.push(r.category);
    for (const g of vfxGroups) if (merged.indexOf(g) < 0) merged.push(g);
    VFX_GROUPS = merged;
    SCREEN_ROWS = screenRows;
    EXTRA_CAT_KEYS = {};
    for (const r of screenRows) EXTRA_CAT_KEYS[r.category] = r.catKey;
}

function groupTextKey(tab: Tab, i: number): string {
    if (i === 0) return T.chipAll;
    const list = tab === "sfx" ? SFX_GROUPS : VFX_GROUPS;
    const name = list[i - 1];
    if (name === undefined) return T.chipAll;
    const extra = EXTRA_CAT_KEYS[name];
    if (extra !== undefined) return extra;
    for (const e of CAT_TEXT) if (e.text === name) return e.key;
    return T.chipAll;
}

function groupName(tab: Tab, i: number): string {
    if (i === 0) return "*";
    const list = tab === "sfx" ? SFX_GROUPS : VFX_GROUPS;
    return list[i - 1] ?? "";
}

function allRows(tab: Tab): Row[] {
    const out: Row[] = [];
    if (tab === "sfx") {
        for (const e of SFX_CATALOG) out.push({ type: "sfx", entry: e });
        return out;
    }
    for (const e of VFX_CATALOG) out.push({ type: "spawn", entry: e });
    for (const r of SCREEN_ROWS) out.push(r);
    return out;
}

/**
 * The saved assets, in the order they were saved.
 *
 * A query still applies, so searching inside the shortlist works as it does
 * everywhere else. The group rail is not offered here -- a shortlist is meant to be
 * short -- and the type badges say which of the two kinds each entry is.
 */
export function favRows(ui: PlayerUi, f: FilterState): Row[] {
    const q = f.query.trim().toLowerCase();
    const out: Row[] = [];
    for (const key of ui.favourites) {
        const tpl = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
        const r: Row | undefined = tpl !== undefined ? { type: "tpl", tpl: tpl } : findRow(key);
        if (r === undefined || r.type === "screen") continue;
        if (!matches(r, "vfx", f)) continue;
        if (!matchesQuery(r, q)) continue;
        out.push(r);
    }
    return out;
}

export function isFavourite(ui: PlayerUi, key: string): boolean {
    return ui.favourites.indexOf(key) >= 0;
}

/**
 * The list the menu is currently showing, and the only place it is derived.
 *
 * render() and the row buttons both call this. They used to compute it separately,
 * and on the shortlist they disagreed: listFor("fav", ...) falls through to the "*"
 * group and returns every VFX row, so a click on a saved asset addressed an unrelated
 * catalog entry and deleting a favourite added a new one instead.
 */
export function visibleList(ui: PlayerUi): Row[] {
    if (isTesterTab(ui.tab)) return [];
    const f = filtersOf(ui);
    return ui.tab === "fav" ? favRows(ui, f) : listFor(ui.tab, ui.group, f);
}

export function listFor(tab: Tab, group: number, f: FilterState): Row[] {
    const q = f.query.trim().toLowerCase();
    const source = q === "" ? groupRows(tab, group) : allRows(tab);
    const out: Row[] = [];
    for (const r of source) {
        if (!matches(r, tab, f)) continue;
        if (!matchesQuery(r, q)) continue;
        out.push(r);
    }
    return out;
}

function groupRows(tab: Tab, group: number): Row[] {
    const name = groupName(tab, group);
    const out: Row[] = [];
    for (const r of allRows(tab)) if (name === "*" || rowCategory(r) === name) out.push(r);
    return out;
}

export function totalCount(tab: Tab): number {
    return allRows(tab).length;
}

export function groupCounts(tab: Tab): number[] {
    const n = tab === "sfx" ? SFX_GROUPS.length : VFX_GROUPS.length;
    const out: number[] = [];
    for (let i = 0; i < n + 1; i++) out.push(groupRows(tab, i).length);
    return out;
}

export function perPage(): number {
    return GRID.rows;
}

export function pageCount(n: number): number {
    return Math.max(1, Math.ceil(n / perPage()));
}

export function pageSlice<T>(list: T[], page: number): T[] {
    const out: T[] = [];
    const start = page * perPage();
    for (let i = start; i < start + perPage() && i < list.length; i++) out.push(list[i]);
    return out;
}

export function findRow(key: string): Row | undefined {
    if (key.startsWith("screen:")) {
        const id = key.slice(7);
        for (const r of SCREEN_ROWS) if (r.id === id) return r;
        return undefined;
    }
    for (const e of SFX_CATALOG) if (e.name === key) return { type: "sfx", entry: e };
    for (const e of VFX_CATALOG) if (e.name === key) return { type: "spawn", entry: e };
    return undefined;
}

const DISPATCH: { onAction?: (ui: PlayerUi, action: string) => void } = {};

export function setActionHandler(fn: (ui: PlayerUi, action: string) => void): void {
    DISPATCH.onAction = fn;
}

interface Handle {
    el: UI.Element;
    kind: "container" | "text" | "textbutton";
    labelled: boolean;
    /**
     * True while the button is held down.
     *
     * Not hover. There is no hover: bf6-portal-utils does not route a hover event
     * (ui/index.ts logs "HoverIn and HoverOut button events not supported") and
     * exposes no hover colour, so the engine's hoverColor is only reachable through
     * the raw mod.AddUIButton overloads, which AGENT.md section 5 forbids.
     *
     * Transient, and render() is state-driven, so it cannot live only inside the
     * handlers: the next pass re-applies baseColor and would wipe a highlight the
     * player is still looking at. The update path consults this instead.
     */
    lit: boolean;
}

export interface PlayerUi {
    player: mod.Player;
    pid: number;
    tab: Tab;
    open: boolean;
    group: number;
    railPage: number;
    page: number;
    selectedKey: string;
    armedKey: string;
    /**
     * Saved assets, as row keys, in the order they were saved.
     *
     * An array rather than a Set because the order is the point: the SAVED tab is a
     * shortlist someone is building, and a shortlist that reshuffles itself every time
     * they add to it is useless for the thing they are making it for.
     */
    favourites: string[];
    scale: number;
    amp: number;
    rng: number;
    query: string;
    searchOpen: boolean;
    kbPage: number;
    spawnedCount: number;
    fDim: string;
    fKind: string;
    fVfx: string;
    /** MUSIC / RADIO tester state; see src/tester.ts. */
    tester: TesterState;

    root: UIContainer | undefined;
    nodes: Record<string, Handle>;
    keyAct: string[];
    pfxAct: string[];
    rowKeys: string[];
    /**
     * The action each filter-chip slot currently dispatches.
     *
     * Empty for an unused slot. The chips are keyed by slot rather than by action
     * because the two tabs emit different actions for the same slot -- the sfx tab
     * puts fd2 where the vfx tab puts fp -- and keying by action stacked two
     * buttons on one position.
     */
    chipAct: string[];
}

export function prefixesFor(tab: Tab): readonly PrefixEntry[] {
    return tab === "sfx" ? SFX_PREFIXES : VFX_PREFIXES;
}

export function filtersOf(ui: PlayerUi): FilterState {
    return { query: ui.query, dim: ui.fDim, kind: ui.fKind, vfx: ui.fVfx };
}

function sfxRowFields(ui: PlayerUi, e: SfxEntry, selected: boolean, armed: boolean): Scope {
    const isLoop = e.kind === "loop";
    const is3d = e.dim === "3d";
    const b1c = is3d ? P.blue : P.amber;
    const b2c = isLoop ? P.green : P.grey;
    return {
        bg: selected ? P.rowSel : P.row,
        name: K(e.key),
        nameColor: selected ? P.ink : P.inkDim,
        category: K(e.catKey),
        favLabel: K(isFavourite(ui, e.name) ? T.favRemove : T.favAdd),
        favColor: isFavourite(ui, e.name) ? P.amber : P.inkDim,
        favBg: isFavourite(ui, e.name) ? P.rowSel : P.row,
        stopLabel: K(T.stop),
        stopColor: P.inkDim,
        stopBg: P.panel,
        playLabel: K(T.play),
        // PLAY is the accent on this row, so it stays green whether or not the row
        // is the armed one -- the point of the button is "hear this now".
        playColor: "#FFFFFF",
        playBg: isLoop ? P.green : P.blue,
        actColor: "#FFFFFF",
        actBg: is3d ? P.blue : P.amber,
        b1: ui.tab === "fav" ? K(T.kindSfx) : K(is3d ? T.chip3d : T.chip2d),
        b1Color: ui.tab === "fav" ? P.blue : b1c,
        b1Bg: ui.tab === "fav" ? P.blue : b1c,
        b2: ui.tab === "fav" ? mod.Message(T.logEmpty) : K(isLoop ? T.chipLoop : T.chipOne),
        b2Color: ui.tab === "fav" ? P.row : b2c,
        b2Bg: ui.tab === "fav" ? P.row : b2c,
        selLabel: K(armed ? T.armedWord : T.select),
        selColor: armed ? "#FFFFFF" : P.ink,
        selBg: armed ? P.green : selected ? P.rowSel : P.row,
    };
}

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

function vfxRowFields(ui: PlayerUi, r: Row, selected: boolean, armed: boolean, scale: number): Scope {
    if (r.type === "sfx") return sfxRowFields(ui, r.entry, selected, armed);
    if (r.type === "tpl") return tplRowFields(r.tpl, selected);
    const world = r.type === "spawn";
    const b1c = world ? P.violet : P.green;
    const b2c = world ? P.blue : P.amber;
    const saved = isFavourite(ui, rowKey(r));
    // On the shortlist the attribute badges are redundant -- everything in it is the
    // same kind of choice -- so they become a type badge instead.
    const onShortlist = ui.tab === "fav";
    const kindColor = P.violet;
    return {
        bg: selected ? P.rowSel : P.row,
        name: K(rowTextKey(r)),
        nameColor: selected ? P.ink : P.inkDim,
        category: K(rowCatTextKey(r)),
        favLabel: K(saved ? T.favRemove : T.favAdd),
        favColor: saved ? P.amber : P.inkDim,
        favBg: saved ? P.rowSel : P.row,
        stopLabel: K(T.stop),
        stopColor: P.inkDim,
        stopBg: P.panel,
        playLabel: K(T.play),
        playColor: "#FFFFFF",
        playBg: b1c,
        actGlyph: K(world ? T.spawnGlyph : T.effectGlyph),
        actColor: "#FFFFFF",
        actBg: b1c,
        b1: onShortlist ? K(T.kindVfx) : world ? mod.Message(TPL.scaleOf, scale) : K(T.chipPlayer),
        b1Color: onShortlist ? kindColor : b1c,
        b1Bg: onShortlist ? kindColor : b1c,
        b2: onShortlist ? mod.Message(T.logEmpty) : K(world ? T.chipWorld : T.chipOne),
        b2Color: onShortlist ? P.row : b2c,
        b2Bg: onShortlist ? P.row : b2c,
        selLabel: K(armed ? T.armedWord : T.select),
        selColor: armed ? "#FFFFFF" : P.ink,
        selBg: armed ? P.green : selected ? P.rowSel : P.row,
    };
}

export function railFields(tab: Tab, row: number, count: number, active: boolean): Scope {
    const label = row === 0 ? T.chipAll : groupTextKey(tab, row - 1);
    return {
        label: mod.Message(TPL.gap2, label, count),
        color: active ? "#FFFFFF" : P.inkDim,
        bg: active ? P.hot : P.line,
    };
}

function activeFilterLabel(ui: PlayerUi): mod.Message {
    const bits: string[] = [];
    if (ui.fDim !== "") bits.push(ui.fDim === "3d" ? T.chip3d : T.chip2d);
    if (ui.fKind !== "") bits.push(ui.fKind === "loop" ? T.chipLoop : T.chipOne);
    if (ui.fVfx !== "") bits.push(ui.fVfx === "world" ? T.chipWorld : T.chipPlayer);
    if (bits.length === 0) return mod.Message(TPL.filters0);
    if (bits.length === 1) return mod.Message(TPL.filters1, bits[0]);
    if (bits.length === 2) return mod.Message(TPL.filters2, bits[0], bits[1]);
    return mod.Message(TPL.filters3, bits[0], bits[1], bits[2]);
}

export function chromeFields(ui: PlayerUi, shown: number, listed: number, total: number): Scope {
    const sfx = ui.tab === "sfx";
    const onFav = ui.tab === "fav";
    const tester = isTesterTab(ui.tab);
    const debug = debugEnabled();
    const armedRow = ui.armedKey === "" ? undefined : findRow(ui.armedKey);
    const armedTextKey = armedRow === undefined ? T.nothingArmed : rowTextKey(armedRow);
    return {
        menuOpen: ui.open ? "1" : "0",
        sfxParams: sfx ? "1" : "0",
        vfxParams: sfx ? "0" : "1",
        searchOpen: ui.searchOpen ? "1" : "0",
        searchBg: ui.searchOpen ? P.green : P.line,
        // Every tab has a resting background, and the selected one is the same
        // orange as the press highlight. Held as a field rather than a hover
        // state, because the selected tab has to stay lit after the click, and
        // the utils package exposes no cursor-over event to hang it on.
        tabSfxColor: sfx ? "#FFFFFF" : P.inkDim,
        tabSfxBg: sfx ? P.hot : P.line,
        tabVfxColor: ui.tab === "vfx" ? "#FFFFFF" : P.inkDim,
        tabVfxBg: ui.tab === "vfx" ? P.hot : P.line,
        tabFavColor: onFav ? "#FFFFFF" : P.inkDim,
        tabFavBg: onFav ? P.hot : P.line,
        tabMusicColor: ui.tab === "music" ? "#FFFFFF" : P.inkDim,
        tabMusicBg: ui.tab === "music" ? P.hot : P.line,
        tabRadioColor: ui.tab === "radio" ? "#FFFFFF" : P.inkDim,
        tabRadioBg: ui.tab === "radio" ? P.hot : P.line,
        browserOn: tester ? "0" : "1",
        testerOn: tester ? "1" : "0",
        ...testerFields(ui.tab === "radio" ? "radio" : "music", ui.tester),
        // On the shortlist the header's button exports instead of arming: there is
        // nothing to confirm, the whole tab IS the selection.
        selectLabel: onFav ? K(ui.favourites.length === 0 ? T.noFavourites : T.exportFavs) : K(ui.selectedKey === "" ? T.selectAnItem : ui.armedKey === ui.selectedKey ? T.selected : T.select),
        selectColor: onFav ? P.ink : "#FFFFFF",
        selectBg: onFav ? P.panel : ui.selectedKey === "" ? P.row : ui.armedKey === ui.selectedKey ? P.green : P.blue,
        debugLabel: K(debug ? T.debugOn : T.debugOff),
        debugColor: debug ? P.green : P.inkDim,
        debugBg: debug ? P.panel : P.row,
        headBadge: K(sfx ? T.spatiality : T.scaleWord),
        armed: ui.armedKey === "" ? K(T.nothingArmed) : mod.Message(TPL.armedOf, armedTextKey),
        armedColor: ui.armedKey === "" ? P.faint : P.green,
        railSummary: shown === total ? mod.Message(TPL.itemsOf, total) : mod.Message(TPL.matchOf, shown, total),
        page: mod.Message(TPL.pageOf, ui.page + 1, pageCount(shown)),
        amp: mod.Message(TPL.num1, ui.amp),
        rng: mod.Message(TPL.num1, Math.round(ui.rng)),
        scale: mod.Message(TPL.scaleOf, ui.scale),
        spawned: mod.Message(TPL.spawnedOf, ui.spawnedCount),
        queryText: K(T.typeToSearch),
        queryEmpty: ui.query === "" ? "1" : "0",
        queryCount: mod.Message(TPL.matchOf2, shown, total),
        filterSummary: activeFilterLabel(ui),
        hint: hintFor(ui),
    };
    void listed;
}

export function findLabel(key: string): string {
    const r = findRow(key);
    return r === undefined ? key : rowDisplay(r);
}

function hintFor(ui: PlayerUi): mod.Message {
    if (ui.searchOpen) return mod.Message(T.hintSearch);
    if (!ui.open) return mod.Message(T.hintClosed);
    if (ui.tab === "music") return mod.Message(T.hintMusic);
    if (ui.tab === "radio") return mod.Message(T.hintRadio);
    if (ui.tab === "vfx") {
        return mod.Message(ui.selectedKey === "" ? T.hintVfxPick : T.hintVfxArmed);
    }
    return mod.Message(ui.selectedKey === "" ? T.hintSfxPick : T.hintSfxArmed);
}

function ensureWidget(
    ui: PlayerUi,
    n: WidgetNode,
    action: string,
    parent: UI.Parent,
    fields: Fields,
    scope: string,
    ox: number,
    oy: number,
    visible: boolean,
    resolveAction?: () => string
): Handle {
    const x = ox + n.x;
    const y = oy + n.y;
    const h = n.h ?? 0;

    let width = n.w ?? 0;
    if (n.wScale !== undefined) width = width * Number(prop(n, n.wScale, fields, scope) ?? 0);
    if (width < 0) width = 0;

    const bgHexRaw = propStr(n, "bg", fields, scope);
    const bgHex = bgHexRaw ?? "#000000";
    const bgAlpha = Number(prop(n, "bgAlpha", fields, scope) ?? 1);
    const bgFill = uiFill(propStr(n, "fill", fields, scope));
    const tSize = Number(prop(n, "textSize", fields, scope) ?? 7);
    const tColorHex = propStr(n, n.k === "text" ? "color" : "textColor", fields, scope) ?? "#FFFFFF";
    const tAlpha = Number(prop(n, "textAlpha", fields, scope) ?? 1);
    const tAnchor = uiAnchor(propStr(n, "align", fields, scope));
    // A node with no text of its own (a container, a repeat) is not a missing key.
    // Coercing the absent value to "" and feeding it to msgFor() reported
    // MISSING TEXT KEY: "" once at boot, which reads like a broken strings table.
    const rawText = prop(n, "text", fields, scope);
    const label = rawText === undefined || rawText === "" ? mod.Message(T.logEmpty) : msgFor(rawText);

    const existing = ui.nodes[action];
    if (existing !== undefined) {
        existing.el.visible = visible;
        setPosition(existing.el, x, y);
        setSize(existing.el, width, h);
        if (existing.kind === "container") {
            existing.el.bgColor = rgb(bgHex);
            existing.el.bgAlpha = bgAlpha;
            existing.el.bgFill = bgFill;
        } else if (existing.kind === "text") {
            const t = existing.el as UIText;
            t.bgColor = rgb(bgHex);
            t.bgAlpha = bgAlpha;
            t.bgFill = bgFill;
            t.label = label;
            t.textSize = tSize;
            t.textColor = rgb(tColorHex);
            t.textAlpha = tAlpha;
            t.textAnchor = tAnchor;
        } else {
            const b = existing.el as UITextButton;
            b.bgColor = rgb(bgHex);
            b.bgAlpha = bgAlpha;
            b.bgFill = bgFill;
            b.label = label;
            b.textSize = tSize;
            b.textColor = existing.lit ? rgb("#FFFFFF") : rgb(tColorHex);
            b.textAlpha = tAlpha;
            b.textAnchor = tAnchor;
            const pal = buttonPalette(bgHex);
            // Hover wins over base: a state change elsewhere must not wipe the
            // highlight the cursor is currently on.
            b.baseColor = existing.lit ? pal.hover : pal.base;
            b.baseAlpha = bgAlpha;
            b.disabledColor = pal.disabled;
            b.disabledAlpha = bgAlpha;
            b.pressedColor = pal.pressed;
            b.pressedAlpha = bgAlpha;
            b.focusedColor = pal.hover;
            b.focusedAlpha = bgAlpha;
        }
        existing.labelled = true;
        return existing;
    }

    // Creation budget (see renderBatch). Checked before anything is allocated, so
    // a pass that stops here leaves no half-built widget behind.
    if (createBudget <= 0) throw BUDGET_SPENT;
    createBudget--;
    createdThisPass++;

    const base = {
        parent: parent,
        position: { x: x, y: y },
        size: { width: width, height: h },
        anchor: UI.Anchor.TopLeft,
        visible: visible,
        bgColor: rgb(bgHex),
        bgAlpha: bgAlpha,
        bgFill: bgFill,
        depth: UI.Depth.AboveGameUI,
        receiver: ui.player,
    };

    let handle: Handle;
    if (n.k === "container") {
        handle = { el: new UIContainer(base), kind: "container", labelled: false, lit: false };
    } else if (n.k === "text") {
        handle = {
            el: new UIText({
                ...base,
                label: label,
                textSize: tSize,
                textColor: rgb(tColorHex),
                textAlpha: tAlpha,
                textAnchor: tAnchor,
            }),
            kind: "text",
            labelled: true,
            lit: false,
        };
    } else {
        const pal = buttonPalette(bgHex);
        // The focus handlers close over `handle`, which is assigned on the next line.
        // They only ever run on a later engine event, so by then it is bound.
        const btn = new UITextButton({
            ...base,
            label: label,
            textSize: tSize,
            textColor: rgb(tColorHex),
            textAlpha: tAlpha,
            textAnchor: tAnchor,
            enabled: n.enabled !== false,
            baseColor: pal.base,
            baseAlpha: bgAlpha,
            disabledColor: pal.disabled,
            disabledAlpha: bgAlpha,
            pressedColor: pal.pressed,
            pressedAlpha: bgAlpha,
            // The engine's own focused-state repaint, if it does one, uses the same
            // highlight -- so the effect shows even if the handlers below never fire.
            focusedColor: pal.hover,
            focusedAlpha: bgAlpha,
            onClickUp: () => {
                // Settle first, so a render triggered by the action does not inherit
                // the pressed highlight.
                handle.lit = false;
                btn.baseColor = pal.base;
                btn.textColor = rgb(tColorHex);
                const a = resolveAction !== undefined ? resolveAction() : action;
                if (a !== "" && DISPATCH.onAction !== undefined) DISPATCH.onAction(ui, a);
            },
            onClickDown: () => {
                handle.lit = true;
                btn.baseColor = pal.hover;
                btn.textColor = rgb("#FFFFFF");
            },
            onFocusIn: () => {
                // Kept even though it never fires today: if Portal ever maps
                // cursor-over to focus, this is the whole hover feature and it is
                // already wired.
                // Controller-crash instrumentation: focus events only fire on a
                // gamepad, so this is the first line that tells a controller log
                // from a mouse one.
                log("focus in: " + action);
                handle.lit = true;
                btn.baseColor = pal.hover;
                btn.textColor = rgb("#FFFFFF");
            },
            onFocusOut: () => {
                log("focus out: " + action);
                handle.lit = false;
                btn.baseColor = pal.base;
                btn.textColor = rgb(tColorHex);
            },
        });
        handle = {
            el: btn,
            kind: "textbutton",
            labelled: true,
            lit: false,
        };
    }
    ui.nodes[action] = handle;
    return handle;
}

function asParent(h: Handle): UI.Parent {
    return h.el as unknown as UI.Parent;
}

function setPosition(el: UI.Element, x: number, y: number): void {
    el.x = x;
    el.y = y;
}

function setSize(el: UI.Element, w: number, h: number): void {
    el.width = w;
    el.height = h;
}

function buildNodes(
    ui: PlayerUi,
    nodes: readonly SceneNode[],
    parent: UI.Parent,
    fields: Fields,
    scope: string,
    ox: number,
    oy: number,
    prefix: string,
    inheritedVisible: boolean
): void {
    const groupVisible: Record<string, boolean> = {};
    // A group can carry its own origin; children are positioned relative to it.
    const groupOrigin: Record<string, { x: number; y: number }> = {};

    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        if (n.k === "group") {
            const gid = n.id ?? "g" + i;
            if (n.parent !== undefined && groupVisible[n.parent] === false) {
                groupVisible[gid] = false;
                groupOrigin[gid] = { x: 0, y: 0 };
                continue;
            }
            const bound = prop(n, "visible", fields, scope);
            groupVisible[gid] = bound !== undefined ? bound !== "0" && bound !== "false" : n.visible !== false;
            groupOrigin[gid] = { x: n.x, y: n.y };
            continue;
        }

        let gx = 0;
        let gy = 0;
        let visible = inheritedVisible;
        const owner = n.parent;
        if (owner !== undefined) {
            if (groupVisible[owner] === false) visible = false;
            const o = groupOrigin[owner];
            if (o !== undefined) {
                gx = o.x;
                gy = o.y;
            }
        }

        const tag = n.id !== undefined && n.k !== "repeat" && n.id !== "" ? n.id : "x" + i;
        const action = prefix + tag;

        if (n.k === "repeat") {
            const tpl = n.template;
            if (tpl === null || tpl === undefined) continue;
            const count = n.count ?? 0;
            const cols = n.cols ?? 0;
            const gap = n.gap ?? 0;
            const gapX = n.gapX ?? gap;
            const gapY = n.gapY ?? gap;
            const tw = tpl.w ?? 0;
            const th = tpl.h ?? 0;
            for (let j = 0; j < count; j++) {
                const cx = cols > 0 ? (j % cols) * (tw + gapX) : j * (tw + gap);
                const cy = cols > 0 ? Math.floor(j / cols) * (th + gapY) : 0;
                if (!visible && ui.nodes[action + "_r" + j] === undefined) continue;
                ensureWidget(ui, { ...tpl, x: tpl.x + cx, y: tpl.y + cy }, action + "_r" + j, parent, fields, scope, ox + gx + n.x, oy + gy + n.y, visible);
            }
            continue;
        }

        // A hidden node is not created until its group is first shown. Every
        // scene node used to be allocated on the first open, including whole tabs
        // nobody had visited; with the 2026-10-01 widget-burst crash, widgets that
        // are never seen are pure risk.
        if (!visible && ui.nodes[action] === undefined) continue;
        ensureWidget(ui, n, action, parent, fields, scope, ox + gx, oy + gy, visible);
    }
}

export function initUI(ui: PlayerUi): void {
    if (ui.root !== undefined) return;
    ui.root = new UIContainer({
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        anchor: UI.Anchor.TopLeft,
        receiver: ui.player,
        visible: ui.open,
        // The utils reference-count mod.EnableUIInputMode against this flag, which
        // is what the hand-rolled version got wrong and what locked the player out
        // of the match at boot. Their README is explicit: do not also call
        // mod.EnableUIInputMode by hand.
        uiInputModeWhenVisible: true,
    });
    const rows: string[] = [];
    for (let i = 0; i < GRID.rows; i++) rows.push("");
    ui.rowKeys = rows;
    const chipAct: string[] = [];
    for (let i = 0; i < MAX_CHIPS; i++) chipAct.push("");
    ui.chipAct = chipAct;

    const keyAct: string[] = [];
    for (let i = 0; i < KEY_SLOTS; i++) keyAct.push("");
    ui.keyAct = keyAct;
    const pfxAct: string[] = [];
    for (let i = 0; i < PFX_SLOTS; i++) pfxAct.push("");
    ui.pfxAct = pfxAct;
}

function root(ui: PlayerUi): UI.Parent {
    return ui.root ?? UI.ROOT_NODE;
}

export function destroyUI(ui: PlayerUi): void {
    if (ui.root !== undefined) ui.root.delete();
    ui.root = undefined;
    ui.nodes = {};
}

function chipAction(key: string, val: string): string {
    if (val === "") return "fa";
    if (key === "dim") return val === "3d" ? "fd3" : "fd2";
    if (key === "kind") return val === "loop" ? "fl" : "fo";
    if (key === "vfx") return val === "world" ? "fw" : "fp";
    return "fa";
}

function chipIsActive(ui: PlayerUi, key: string, val: string): boolean {
    if (key === "dim") return val === "" ? ui.fDim === "" : ui.fDim === val;
    if (key === "kind") return val === "" ? ui.fKind === "" : ui.fKind === val;
    if (key === "vfx") return val === "" ? ui.fVfx === "" : ui.fVfx === val;
    return false;
}

    /**
 * The strings.json key for a filter chip's label.
 *
 * The empty value has to be tested FIRST. It means "ALL", but it also means
 * c.val is neither "3d" nor "loop" nor "world", so testing the key first fell
 * through to the sibling chip and rendered the ALL chip as "2D" (sfx) or "PLAYER"
 * (vfx).
 */
function chipTextKey(c: { key: string; val: string }): string {
    if (c.val === "") return T.chipAll;
    if (c.key === "dim") return c.val === "3d" ? T.chip3d : T.chip2d;
    if (c.key === "kind") return c.val === "loop" ? T.chipLoop : T.chipOne;
    if (c.key === "vfx") return c.val === "world" ? T.chipWorld : T.chipPlayer;
    return T.chipAll;
}

function bottomKey(action: string): string {
    if (action === "spc") return T.space;
    if (action === "bksp") return T.back;
    if (action === "clr") return T.clear;
    if (action === "done") return T.done;
    return T.search;
}

const QUERY_CELL_W = 11;

const MAX_CHIPS = 5;

const KEY_CHARS: string[] = (() => {
    const out: string[] = [];
    for (const row of KEYBOARD.rows) for (const c of row) if (charKey(c) !== undefined) out.push(c);
    return out;
})();
const KEY_SLOTS = KEY_CHARS.length;
const PFX_SLOTS = KEYBOARD.prefixGrid.max;

// ---------------------------------------------------------------------------
// Batched widget creation. Opening the menu used to create ~245 widgets in one
// tick, and the game now crashes as soon as the menu opens. renderBatch() caps how
// many NEW widgets one pass may create; widgets that already exist are only
// updated and cost nothing. render() is state-driven and idempotent, so the caller
// simply runs another pass a moment later and it picks up where this one stopped.
// ---------------------------------------------------------------------------
const BUDGET_SPENT = { budgetSpent: true };
let createBudget = Number.POSITIVE_INFINITY;
let createdThisPass = 0;

export interface BatchResult {
    complete: boolean;
    created: number;
}

export function renderBatch(ui: PlayerUi, spawnedCount: number, maxNew: number): BatchResult {
    createBudget = maxNew;
    createdThisPass = 0;
    try {
        render(ui, spawnedCount);
        return { complete: true, created: createdThisPass };
    } catch (e) {
        if (e !== BUDGET_SPENT) throw e;
        return { complete: false, created: createdThisPass };
    } finally {
        createBudget = Number.POSITIVE_INFINITY;
    }
}

export function render(ui: PlayerUi, spawnedCount: number): void {
    initUI(ui);
    ui.spawnedCount = spawnedCount;

    const onFav = ui.tab === "fav";
    // The FAVOURITES tab ignores the group rail entirely -- there are no groups in
    // a shortlist -- so its total is the shortlist, not the catalog.
    const tester = isTesterTab(ui.tab);
    const list = visibleList(ui);
    const total = tester ? 0 : onFav ? ui.favourites.length : totalCount(ui.tab);
    const maxPage = pageCount(list.length) - 1;
    if (ui.page > maxPage) ui.page = maxPage;
    if (ui.page < 0) ui.page = 0;

    const parent = root(ui);
    const open = ui.open;
    if (ui.root !== undefined) ui.root.visible = open;

    const fields: Fields = { sh: P, f: chromeFields(ui, list.length, 0, total) };
    buildNodes(ui, SCREEN, parent, fields, "f", 0, 0, "", open);

    // The rail, chips, rows and keyboard live outside the `menu` group, so the
    // group's bind does not cover them. They are gated on `open` explicitly.
    if (!open) return;

    // The tester panel is all scene nodes, drawn by buildNodes above. Everything
    // the browser builds by hand has to be hidden here, for the same reason.
    if (tester) {
        hideBrowserWidgets(ui);
        return;
    }

    // ---- filter chips + search button
    const chips = ui.tab === "sfx" ? FILTERS.sfx : FILTERS.vfx;
    for (let i = 0; i < MAX_CHIPS; i++) {
        const c = chips[i];
        if (c === undefined || onFav) {
            const spare = ui.nodes["chip" + i];
            if (spare !== undefined) spare.el.visible = false;
            ui.chipAct[i] = "";
            continue;
        }
        const active = chipIsActive(ui, c.key, c.val);
        // The slot decides which button this is; the action is read at click time.
        // Keying by action instead put fp and fd2 on the same position and made the
        // chips unreachable.
        ui.chipAct[i] = chipAction(c.key, c.val);
        const label = K(chipTextKey(c));
        const bg = active ? P.blue : P.row;
        const fg = active ? "#FFFFFF" : P.inkDim;
        const cf: Fields = { sh: P, f: { text: label, textColor: fg, bg: bg } };
        ensureWidget(
            ui,
            { k: "textbutton", x: FILTERS.chipX + i * (FILTERS.chipW + FILTERS.gap), y: FILTERS.chipY, w: FILTERS.chipW, h: FILTERS.chipH, fill: "Solid", bg: bg, bgAlpha: 1, text: label, textSize: 13, textColor: fg, align: "Center" },
            "chip" + i,
            parent,
            cf,
            "f",
            0,
            0,
            true,
            () => ui.chipAct[i]
        );
    }
    {
        const sf: Fields = {
            sh: P,
            f: {
                text: K(ui.searchOpen ? T.keyboardOpen : T.search),
                textColor: ui.searchOpen ? "#FFFFFF" : P.ink,
                bg: ui.searchOpen ? P.green : P.panel,
            },
        };
        ensureWidget(ui, { k: "textbutton", x: FILTERS.searchX, y: FILTERS.searchY, w: FILTERS.searchW, h: FILTERS.searchH, fill: "Solid", bg: ui.searchOpen ? P.green : P.panel, bgAlpha: 1, text: K(ui.searchOpen ? T.keyboardOpen : T.search), textSize: 14, textColor: ui.searchOpen ? "#FFFFFF" : P.ink, align: "Center" }, "btnSearch", parent, sf, "f", 0, 0, true);
    }

    // ---- rail, paged (absent on the shortlist: there is nothing to group)
    if (onFav) {
        for (let slot = 0; slot < RAIL.visibleRows - 1; slot++) {
            const spare = ui.nodes["railBtn" + slot];
            if (spare !== undefined) spare.el.visible = false;
        }
        for (const id of ["railAll", "btnRailPrev", "btnRailNext", "railPage"]) {
            const h = ui.nodes[id];
            if (h !== undefined) h.el.visible = false;
        }
    } else {
    const counts = groupCounts(ui.tab);
    // Row 0 of the rail is ALL, which is the absence of a filter rather than an
    // action: the menu already starts on the unfiltered list, so selecting it
    // changed nothing. It is therefore a static text node of its own, permanently,
    // and the group buttons get the rows below it. Both live in separate key
    // namespaces because one slot used to serve both: the same handle was created
    // as a button on a later page and could not become text again, which is how
    // ALL stayed clickable.
    const groupTotal = counts.length - 1;
    const groupRows = RAIL.visibleRows - 1;
    const railPages = Math.max(1, Math.ceil(groupTotal / groupRows));
    if (ui.railPage >= railPages) ui.railPage = railPages - 1;
    if (ui.railPage < 0) ui.railPage = 0;
    const railX = RAIL.x + RAIL.rowPadX;
    const allRow: WidgetNode = { ...RAIL_ROW, k: "text" };
    ensureWidget(ui, allRow, "railAll", parent, { sh: P, rail: railFields(ui.tab, 0, counts[0], false) }, "rail", railX, RAIL.rowsY, true);
    const railFirst = ui.railPage * groupRows;
    for (let slot = 0; slot < groupRows; slot++) {
        const gi = railFirst + slot;
        if (gi >= groupTotal) {
            const spare = ui.nodes["railBtn" + slot];
            if (spare !== undefined) spare.el.visible = false;
            continue;
        }
        const active = ui.group === gi;
        const rf: Fields = { sh: P, rail: railFields(ui.tab, gi + 1, counts[gi + 1], active) };
        // The emitted action is the group index itself, not the slot, so the
        // handler needs no knowledge of paging and the two halves cannot drift.
        const action = "rail" + gi;
        ensureWidget(ui, RAIL_ROW, "railBtn" + slot, parent, rf, "rail", railX, RAIL.rowsY + (slot + 1) * RAIL.rowH, true, () => action);
    }
    // Only the two buttons come from the scene; the page read-out is drawn by
    // hand below so it does not collide with a node buildNodes() would allocate
    // under the same key.
    for (const n of RAIL_PAGER) {
        if (n.k !== "textbutton") continue;
        const nf: Fields = { sh: P, f: { text: n.text === undefined ? mod.Message(T.logEmpty) : S(n.text), textColor: "#FFFFFF", bg: P.orangeDim } };
        ensureWidget(ui, n, n.id ?? "railPagerBtn", parent, nf, "f", 0, 0, open);
    }
    {
        const rp = mod.Message(TPL.railPageOf, ui.railPage + 1, railPages);
        const w = RAIL.rowW - RAIL.pagerW * 2 - 8;
        ensureWidget(
            ui,
            { k: "text", x: RAIL.x + RAIL.rowPadX + RAIL.pagerW + 4, y: RAIL.pagerY, w: w, h: RAIL.pagerH, text: rp, textSize: 11, textColor: P.muted, align: "Center" },
            "railPage",
            parent,
            { sh: P, f: { text: rp, textColor: P.muted } },
            "f",
            0,
            0,
            true
        );
    }
    }

    // ---- rows, one container each so a short page can hide the leftovers
    const page = pageSlice(list, ui.page);
    for (let i = 0; i < GRID.rows; i++) {
        const item = page[i];
        if (item === undefined) {
            ui.rowKeys[i] = "";
            const box = ui.nodes["row" + i];
            if (box !== undefined) box.el.visible = false;
            continue;
        }
        const key = rowKey(item);
        ui.rowKeys[i] = key;
        const rowY = GRID.originY + i * GRID.rowH;
        const box = ensureWidget(
            ui,
            { k: "container", x: GRID.originX, y: rowY, w: GRID.rowW, h: GRID.rowH, fill: "None" },
            "row" + i,
            parent,
            { sh: P },
            "f",
            0,
            0,
            true
        );
        const selected = key === ui.selectedKey;
        const armed = key === ui.armedKey;
        const rf: Fields = { sh: P, r: vfxRowFields(ui, item, selected, armed, ui.scale) };
        buildNodes(ui, ROW, asParent(box), rf, "r", 0, 0, "r" + i + "_", true);
    }

    // ---- simulated keyboard
    if (ui.searchOpen) buildKeyboard(ui, list.length, total);
    else hideKeyboard(ui);
}

/**
 * The query readout.
 *
 * One widget per character, because arbitrary user input has no strings.json key of
 * its own. Portal's UI font is not monospaced, so these are fixed-width cells and
 * spacing varies slightly -- the same compromise the bf6-portal-utils logger makes.
 *
 * Everything here is positioned relative to the keyboard container, not the scene.
 * The key rows subtract kb.y when they are placed; this function used to use the
 * absolute kb.queryY, which put the readout 216px too low -- straight on top of the
 * third key row, where it was invisible under the keys and unreadable. That is why
 * there was nothing to see while typing.
 */
function buildQueryBar(ui: PlayerUi, parent: UI.Parent, kb: typeof KEYBOARD, shown: number, total: number): void {
    const q = ui.query;
    const qx = 16;
    const qy = kb.queryY - kb.y;
    const countW = 380;
    const fieldW = kb.w - countW - 40;

    // A visible field, not floating text. Without a background the readout is the
    // same near-black as the keyboard behind it and there is no cue that it is an
    // input at all.
    const field = ensureWidget(
        ui,
        { k: "container", x: qx - 8, y: qy - 6, w: fieldW + 16, h: kb.queryH + 12, fill: "Solid", bg: P.line, bgAlpha: 1 },
        "kbField",
        parent,
        { sh: P },
        "f",
        0,
        0,
        true
    );
    field.el.visible = true;

    const hint = K(ui.kbPage === 1 ? T.tapPrefix : T.typeToSearchDot);
    const hintH = ensureWidget(ui, { k: "text", x: qx, y: qy, w: fieldW, h: kb.queryH, text: hint, textSize: 20, textColor: P.faint, align: "Left" }, "kbHint", parent, { sh: P, f: { text: hint, textColor: P.faint } }, "f", 0, 0, q === "");
    hintH.el.visible = q === "";

    const cm = mod.Message(TPL.matchOf2, shown, total);
    ensureWidget(ui, { k: "text", x: kb.w - countW - 16, y: qy, w: countW, h: kb.queryH, text: cm, textSize: 14, textColor: P.muted, align: "Right" }, "kbCount", parent, { sh: P, f: { text: cm, textColor: P.muted } }, "f", 0, 0, true);

    for (let i = 0; i < MAX_QUERY; i++) {
        const ch = q[i];
        const key = ch === undefined ? undefined : charKey(ch);
        const h = ensureWidget(
            ui,
            { k: "text", x: qx + i * QUERY_CELL_W, y: qy, w: QUERY_CELL_W, h: kb.queryH, text: key === undefined ? mod.Message(T.logEmpty) : mod.Message(key), textSize: 20, textColor: P.ink, align: "Center" },
            "kbq" + i,
            parent,
            { sh: P, f: { text: key === undefined ? mod.Message(T.logEmpty) : mod.Message(key), textColor: P.ink } },
            "f",
            0,
            0,
            key !== undefined
        );
        h.el.visible = key !== undefined;
    }
    // A trailing underscore stands in for a cursor: the block-cursor glyph the
    // design started with is not in Portal's font and rendered as "*".
    const cur = ensureWidget(ui, { k: "text", x: qx + q.length * QUERY_CELL_W, y: qy, w: QUERY_CELL_W, h: kb.queryH, text: K(T.charCursor), textSize: 20, textColor: P.green, align: "Center" }, "kbcur", parent, { sh: P, f: { text: K(T.charCursor), textColor: P.green } }, "f", 0, 0, true);
    cur.el.visible = q !== "";
}

function buildKeyboard(ui: PlayerUi, shown: number, total: number): void {
    const kb = KEYBOARD;
    const parent = root(ui);
    const box = ensureWidget(ui, { k: "container", x: kb.x, y: kb.y, w: kb.w, h: kb.h, fill: "Solid", bg: P.shell, bgAlpha: 1 }, "kbRoot", parent, { sh: P }, "f", 0, 0, true);
    const kbParent = asParent(box);

    buildQueryBar(ui, kbParent, kb, shown, total);

    if (ui.kbPage === 1) {
        // Page 2: clickable asset prefixes, so nobody has to type SFX_ / Gadgets_ / Snow.
        hideSlots(ui, "key", KEY_SLOTS);
        const pg = kb.prefixGrid;
        const all = prefixesFor(ui.tab);
        const n = all.length > pg.max ? pg.max : all.length;
        for (let i = 0; i < pg.max; i++) {
            const e = all[i];
            if (e === undefined || i >= n) {
                const spare = ui.nodes["pfx" + i];
                if (spare !== undefined) spare.el.visible = false;
                continue;
            }
            const col = i % pg.cols;
            const row = Math.floor(i / pg.cols);
            if (row >= pg.rows) continue;
            ui.pfxAct[i] = "pfx_" + e.token;
            const tile = i;
            ensureWidget(
                ui,
                {
                    k: "textbutton",
                    x: pg.x0 - kb.x + col * (pg.w + pg.gap),
                    y: pg.rowY[row] - kb.y,
                    w: pg.w,
                    h: pg.h,
                    fill: "Solid",
                    bg: P.hairline,
                    bgAlpha: 1,
                    text: K(e.key),
                    textSize: 12,
                    textColor: P.ink,
                    align: "Center",
                },
                "pfx" + i,
                kbParent,
                { sh: P, f: { text: K(e.key), textColor: P.ink, bg: P.hairline } },
                "f",
                0,
                0,
                true,
                () => ui.pfxAct[tile]
            );
        }
    } else {
        // Page 1: QWERTY.
        hideSlots(ui, "pfx", PFX_SLOTS);
        for (let r = 0; r < kb.rows.length; r++) {
            const chars = kb.rows[r];
            for (let c = 0; c < chars.length; c++) {
                const ch = chars[c];
                const ck = charKey(ch);
                if (ck === undefined) continue;
                const slot = KEY_CHARS.indexOf(ch);
                if (slot < 0) continue;
                ui.keyAct[slot] = "key_" + ch;
                const cm = mod.Message(ck);
                ensureWidget(ui, { k: "textbutton", x: kb.x0 - kb.x + c * (kb.keyW + kb.gap), y: kb.rowY[r] - kb.y, w: kb.keyW, h: kb.keyH, fill: "Solid", bg: P.hairline, bgAlpha: 1, text: cm, textSize: 20, textColor: P.ink, align: "Center" }, "key" + slot, kbParent, { sh: P, f: { text: cm, textColor: P.ink, bg: P.hairline } }, "f", 0, 0, true, () => ui.keyAct[slot]);
            }
        }
    }

    // bottom row
    let bx = kb.x0 - kb.x;
    for (const b of kb.bottom) {
        const isDone = b.action === "done";
        const isPage = b.action === "page";
        const label = K(isPage ? (ui.kbPage === 1 ? T.abcKeys : T.prefixes) : bottomKey(b.action));
        const bg = isDone ? P.green : b.action === "clr" ? P.redDim : isPage ? P.violet : P.row;
        ensureWidget(ui, { k: "textbutton", x: bx, y: kb.bottomY - kb.y, w: b.w, h: kb.bottomH, fill: "Solid", bg: bg, bgAlpha: 1, text: label, textSize: 17, textColor: isDone ? "#FFFFFF" : P.ink, align: "Center" }, b.action, kbParent, { sh: P, f: { text: label, textColor: isDone ? "#FFFFFF" : P.ink, bg: bg } }, "f", 0, 0, true);
        bx += b.w + kb.gap;
    }
}

/** Hides every widget render() builds by hand for the asset browser. */
function hideBrowserWidgets(ui: PlayerUi): void {
    hideSlots(ui, "chip", MAX_CHIPS);
    hideSlots(ui, "railBtn", RAIL.visibleRows - 1);
    hideSlots(ui, "row", GRID.rows);
    for (const id of ["btnSearch", "railAll", "btnRailPrev", "btnRailNext", "railPage"]) {
        const h = ui.nodes[id];
        if (h !== undefined) h.el.visible = false;
    }
    hideKeyboard(ui);
}

function hideSlots(ui: PlayerUi, prefix: string, max: number): void {
    for (let i = 0; i < max; i++) {
        const h = ui.nodes[prefix + i];
        if (h !== undefined) h.el.visible = false;
    }
}

function hideKeyboard(ui: PlayerUi): void {
    const box = ui.nodes["kbRoot"];
    if (box !== undefined) box.el.visible = false;
    hideSlots(ui, "key", KEY_SLOTS);
    hideSlots(ui, "pfx", PFX_SLOTS);
    hideSlots(ui, "kbq", MAX_QUERY);
    for (const a of ["kbHint", "kbCount", "kbcur"]) {
        const h = ui.nodes[a];
        if (h !== undefined) h.el.visible = false;
    }
}
