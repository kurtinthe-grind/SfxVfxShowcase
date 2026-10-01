// SFX / VFX Showcase - Battlefield 6 Portal
//
// A browser for the game's sound and effect catalogs, reached through the portal
// gadget. Aim opens it, pick an asset, and firing the gadget raycasts from your eyes
// and spawns what you armed at the hit point. Every row can also be played in place,
// and + saves an asset to the shortlist on the SAVED tab, which exports the
// index-file names to the log.
import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";

import { SFX_CATALOG, SFX_CATEGORIES, SFX_PREFIXES, type SfxEntry, VFX_CATALOG, VFX_CATEGORIES, VFX_PREFIXES } from "./catalog";
import { CONFIG } from "./config";
import { debugEnabled, initLog, log, logAlways, setDebug } from "./diag";
import { handleTesterAction, loadStartupMusic, musicSmokeTest, newTesterState } from "./tester";
import { T, TPL } from "./text.gen";
import {
    destroyUI,
    filtersOf,
    findRow,
    isTesterTab,
    listFor,
    MAX_QUERY,
    type PlayerUi,
    type Row,
    pageCount,
    pageSlice,
    registerGroups,
    renderBatch,
    rowKey,
    rowCategory,
    rowRawName,
    type ScreenRow,
    setActionHandler,
    visibleList,
} from "./ui";

const ZERO = mod.CreateVector(0, 0, 0);
const ONE = mod.CreateVector(1, 1, 1);

type PreviewState =
    | { readonly type: "sfx"; readonly sfx: mod.SFX; readonly key: string }
    | { readonly type: "screen"; readonly id: string; readonly key: string };

interface PlayerState {
    ui: PlayerUi;
    spawned: mod.VFX[];
    playing: mod.SFX[];
    /** The sound or effect currently auditioned, so a replay replaces it. */
    preview: PreviewState | undefined;
    /** A follow-up widget batch is already scheduled; see renderLogged(). */
    building: boolean;
}

const states: Record<number, PlayerState> = {};

// ------------------------------------------------------- player-wide effects
// These are not world objects: they toggle a post-process / soldier state on the
// firing player only, so they work on any map with nothing placed.

interface ScreenFx {
    id: string;
    display: string;
    category: string;
    key: string;
    cat: string;
    effect: mod.ScreenEffects;
    soldier?: mod.SoldierEffects;
}

const SCREEN_FX: ScreenFx[] = [
    { id: "vl7gas", display: "VL7 Gas Mask", category: "Gas", cat: T.catGas, key: T.screenVl7gas, effect: mod.ScreenEffects.VL7, soldier: mod.SoldierEffects.VL7Effect },
    { id: "night", display: "Night Vision", category: "Screen", cat: T.catScreen, key: T.screenNight, effect: mod.ScreenEffects.Night },
    { id: "saturated", display: "Saturated", category: "Screen", cat: T.catScreen, key: T.screenSaturated, effect: mod.ScreenEffects.Saturated },
    { id: "stealth", display: "Stealth", category: "Screen", cat: T.catScreen, key: T.screenStealth, effect: mod.ScreenEffects.Stealth },
];

// ------------------------------------------------------------------ logging
//
// console.log is the sink. bf6-portal-utils/logging wraps it in try/catch so a
// logging failure can never crash the mod, and tags every line so a pasted log is
// unambiguous. Level is Debug: this is a build being debugged, not a shipped mode.

function labelOf(key: string): string {
    return key === "" ? "(none)" : key;
}

Events.OnGameModeStarted.subscribe(() => {
    initLog();
    log(
        `game mode started: ${SFX_CATALOG.length} sfx, ${VFX_CATALOG.length} vfx, ` +
            `${SFX_PREFIXES.length + VFX_PREFIXES.length} prefixes, ` +
            `${SCREEN_FX.length} player-wide, menu starts closed`
    );
    const screenRows: ScreenRow[] = [];
    for (const f of SCREEN_FX) {
        screenRows.push({ type: "screen", id: f.id, display: f.display, category: f.category, key: f.key, catKey: f.cat });
    }
    registerGroups(
        SFX_CATEGORIES as unknown as string[],
        VFX_CATEGORIES as unknown as string[],
        screenRows
    );
    mod.SetSpawnMode(mod.SpawnModes.AutoSpawn);
    // MUSIC / RADIO tester: Core only, as early as possible. LOAD switches.
    loadStartupMusic();
});

// Grant the portal gadget at runtime on every deployment, so it survives death
// and respawn. Tier 0: AddEquipment(player, gadget: Gadgets) with
// Gadgets.Misc_PortalGadget; the SDK PortalGadgetExample does exactly this.
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    mod.AddEquipment(player, mod.Gadgets.Misc_PortalGadget);
    ensure(player);
    log(`deploy: player ${mod.GetObjId(player)} granted the portal gadget`);
    // Once per match: proves whether music can play in this experience at all.
    musicSmokeTest();
});

Events.OnPlayerLeaveGame.subscribe((playerId: number) => {
    const st = states[playerId];
    if (st === undefined) return;
    clearAll(st);
    destroyUI(st.ui);
    delete states[playerId];
});

function ensure(player: mod.Player): PlayerState {
    const pid = mod.GetObjId(player);
    const existing = states[pid];
    if (existing !== undefined) return existing;
    const ui: PlayerUi = {
        player: player,
        pid: pid,
        tab: "sfx",
        // Closed until the player aims the portal gadget. Opening on spawn buried
    // the HUD over the whole screen and looked like a broken UI.
    open: false,
        group: 0,
        railPage: 0,
        page: 0,
        selectedKey: "",
        armedKey: "",
        favourites: [],
        scale: CONFIG.defaultScale,
        amp: CONFIG.defaultAmplitude,
        rng: CONFIG.defaultRange,
        query: "",
        searchOpen: false,
        kbPage: 0,
        fDim: "",
        fKind: "",
        fVfx: "",
        spawnedCount: 0,
        root: undefined,
        nodes: {},
        keyAct: [],
        pfxAct: [],
        rowKeys: [],
        chipAct: [],
        tester: newTesterState(),
    };
    const st: PlayerState = { ui: ui, spawned: [], playing: [], preview: undefined, building: false };
    states[pid] = st;
    renderLogged(st);
    return st;
}

function redraw(st: PlayerState): void {
    renderLogged(st);
}

// Widgets are created in batches of CONFIG.widgetsPerBatch, one batch every
// CONFIG.widgetBatchDelayMs, instead of all at once. A pass that runs out of
// budget schedules the next one; only one follow-up is ever pending per player,
// and any redraw in between simply spends that pass's budget too.
//
// Crash instrumentation: a "render begin" with no matching "render end" means
// the game died inside the render pass.
function renderLogged(st: PlayerState): void {
    const ui = st.ui;
    log(`render begin: open=${ui.open} tab=${ui.tab}`);
    const r = renderBatch(ui, st.spawned.length, CONFIG.widgetsPerBatch);
    log(`render end: open=${ui.open} created=${r.created} complete=${r.complete}`);
    if (r.complete || st.building) return;
    st.building = true;
    Timers.setTimeout(() => {
        st.building = false;
        if (states[ui.pid] === st) redraw(st);
    }, CONFIG.widgetBatchDelayMs);
}

// Never delete a widget inside its own click event.
function defer(st: PlayerState): void {
    Timers.setTimeout(() => redraw(st), 0);
}

/**
 * Clicks arrive here.
 *
 * ui.ts hands every button an onClickUp closure that calls this, so there is no
 * widget-name parsing and no second subscription to OnPlayerUIButtonEvent --
 * bf6-portal-utils/ui already owns that event and routes it by element id.
 */
setActionHandler((ui, action) => {
    const st = states[mod.GetObjId(ui.player)];
    if (st !== undefined) handle(st, action);
});

/**
 * The only place `ui.open` changes.
 *
 * render() pushes this onto the root container, which carries
 * uiInputModeWhenVisible: true, so bf6-portal-utils reference-counts
 * mod.EnableUIInputMode against it. Calling EnableUIInputMode by hand alongside
 * that is unsupported (the engine cannot be queried for the state) and is what
 * locked the player out of the match at boot.
 */
function setOpen(ui: PlayerUi, open: boolean): void {
    if (ui.open === open) return;
    ui.open = open;
    log(`menu ${open ? "opened" : "closed"}`);
}

function handle(st: PlayerState, action: string): void {
    const ui = st.ui;
    log(
        `button: ${action} | open=${ui.open} tab=${ui.tab} group=${ui.group} page=${ui.page} ` +
            `query="${ui.query}" kbPage=${ui.kbPage} search=${ui.searchOpen} ` +
            `selected=${labelOf(ui.selectedKey)} armed=${labelOf(ui.armedKey)} ` +
            `dim=${ui.fDim} kind=${ui.fKind} vfx=${ui.fVfx} amp=${ui.amp} rng=${ui.rng} scale=${ui.scale}`
    );

    if (action === "btnClose") {
        setOpen(ui, false);
        defer(st);
        return;
    }
    if (action === "tabSfx" || action === "tabVfx" || action === "tabFav" || action === "tabMusic" || action === "tabRadio") {
        ui.tab = action === "tabSfx" ? "sfx" : action === "tabVfx" ? "vfx" : action === "tabFav" ? "fav" : action === "tabMusic" ? "music" : "radio";
        ui.group = 0;
        ui.railPage = 0;
        ui.page = 0;
        ui.selectedKey = "";
        defer(st);
        return;
    }
    // MUSIC / RADIO tester: every action is mt*, owned by src/tester.ts.
    if (action.slice(0, 2) === "mt") {
        if (isTesterTab(ui.tab) && handleTesterAction(ui.tab, ui.tester, ui.player, action, () => defer(st))) {
            defer(st);
            return;
        }
        log(`UNHANDLED ACTION "${action}" (open=${ui.open} tab=${ui.tab})`);
        return;
    }
    if (action === "btnSearch") {
        ui.searchOpen = !ui.searchOpen;
        defer(st);
        return;
    }

    // Filter chips: fa=clear, fd3/fd2=3D/2D, fl/fo=loop/one-shot, fw/fp=world/player.
    if (action.length === 2 || action.length === 3) {
        const F = action[0] === "f";
        if (F && action.charAt(1) !== undefined) {
            const on = action;
            if (on === "fa") {
                ui.fDim = "";
                ui.fKind = "";
                ui.fVfx = "";
            } else if (on === "fd3") ui.fDim = ui.fDim === "3d" ? "" : "3d";
            else if (on === "fd2") ui.fDim = ui.fDim === "2d" ? "" : "2d";
            else if (on === "fl") ui.fKind = ui.fKind === "loop" ? "" : "loop";
            else if (on === "fo") ui.fKind = ui.fKind === "oneshot" ? "" : "oneshot";
            else if (on === "fw") ui.fVfx = ui.fVfx === "world" ? "" : "world";
            else if (on === "fp") ui.fVfx = ui.fVfx === "screen" ? "" : "screen";
            else return;
            ui.page = 0;
            defer(st);
            return;
        }
    }

    // Simulated keyboard: key_<char> appends; page/spc/bksp/clr/done act on the query.
    if (action.slice(0, 4) === "key_") {
        if (ui.query.length >= MAX_QUERY) return;
        ui.query += action.slice(4);
        ui.page = 0;
        defer(st);
        return;
    }
    if (action === "page") {
        ui.kbPage = ui.kbPage === 1 ? 0 : 1;
        defer(st);
        return;
    }
    if (action.slice(0, 4) === "pfx_") {
        const token = action.slice(4);
        if (ui.query.length < MAX_QUERY) ui.query += token;
        // Typing a prefix is only a starting point, so jump back to the free-text
        // page where the player can finish the word.
        ui.kbPage = 0;
        ui.page = 0;
        defer(st);
        return;
    }
    if (action === "spc") {
        if (ui.query.length < MAX_QUERY) ui.query += " ";
        ui.page = 0;
        defer(st);
        return;
    }
    if (action === "bksp") {
        ui.query = ui.query.slice(0, ui.query.length - 1);
        ui.page = 0;
        defer(st);
        return;
    }
    if (action === "clr") {
        ui.query = "";
        ui.page = 0;
        defer(st);
        return;
    }
    if (action === "done") {
        ui.searchOpen = false;
        defer(st);
        return;
    }
    if (action === "btnPrev") {
        ui.page = Math.max(0, ui.page - 1);
        defer(st);
        return;
    }
    if (action === "btnNext") {
        ui.page = Math.min(pageCount(listFor(ui.tab, ui.group, filtersOf(ui)).length) - 1, ui.page + 1);
        defer(st);
        return;
    }
    if (action === "btnAmpDown") {
        ui.amp = Math.max(CONFIG.minAmplitude, ui.amp - CONFIG.amplitudeStep);
        defer(st);
        return;
    }
    if (action === "btnAmpUp") {
        ui.amp = Math.min(CONFIG.maxAmplitude, ui.amp + CONFIG.amplitudeStep);
        defer(st);
        return;
    }
    if (action === "btnRngDown") {
        ui.rng = Math.max(CONFIG.minRange, ui.rng - CONFIG.rangeStep);
        defer(st);
        return;
    }
    if (action === "btnRngUp") {
        ui.rng = Math.min(CONFIG.maxRange, ui.rng + CONFIG.rangeStep);
        defer(st);
        return;
    }
    if (action === "btnScaleDown") {
        ui.scale = Math.max(CONFIG.minScale, round2(ui.scale - CONFIG.scaleStep));
        defer(st);
        return;
    }
    if (action === "btnScaleUp") {
        ui.scale = Math.min(CONFIG.maxScale, round2(ui.scale + CONFIG.scaleStep));
        defer(st);
        return;
    }
    if (action === "btnStopAll") {
        stopAll(st);
        defer(st);
        return;
    }
    if (action === "btnUndo") {
        undoLast(st);
        defer(st);
        return;
    }
    if (action === "btnDeleteAll") {
        clearAll(st);
        defer(st);
        return;
    }
    if (action === "btnSelect") {
        // On the shortlist the same button exports, because there is nothing to
        // confirm there -- the tab is the selection.
        if (ui.tab === "fav") {
            exportFavourites(st);
            return;
        }
        armSelected(st);
        return;
    }

    if (action === "btnDebug") {
        setDebug(debugEnabled() === false);
        defer(st);
        return;
    }
    // Rail: rail<group> selects a group. The number is the group index itself,
    // not a slot on the current page, so the handler needs no paging arithmetic
    // to agree with the emit side. "c<row>" is still accepted so a stray legacy
    // name cannot dead-end, but nothing emits it any more.
    if (action.slice(0, 4) === "rail" || (action.charAt(0) === "c" && action.length > 1)) {
        const body = action.slice(0, 4) === "rail" ? action.slice(4) : action.slice(1);
        const group = parseInt(body, 10);
        // 0 is a valid group. An earlier "row < 1" guard made the first group
        // unselectable, so choosing any group was a one-way trip.
        if (isNaN(group) || group < 0) return;
        // The ALL row is a static text node and emits nothing, so there is no
        // "clear the filter" action to accept here.
        ui.group = group;
        ui.page = 0;
        defer(st);
        return;
    }

    // ---- the rail's own pager
    if (action === "btnRailPrev") {
        ui.railPage = Math.max(0, ui.railPage - 1);
        defer(st);
        return;
    }
    if (action === "btnRailNext") {
        ui.railPage = ui.railPage + 1;
        defer(st);
        return;
    }

    // Row actions: r<index>_<act|sel>
    if (action.charAt(0) === "r") {
        const us = action.indexOf("_");
        if (us < 2) return;
        const idx = parseInt(action.slice(1, us), 10);
        if (isNaN(idx)) return;
        const tag = action.slice(us + 1);
        const page = pageSlice(visibleList(ui), ui.page);
        const item = page[idx];
        if (item === undefined) return;
        const key = rowKey(item);
        if (tag === "sel") {
            // One click arms. This used to only highlight, which made every pick a
            // two-step: row, then the header's SELECT again. The menu stays open --
            // closing is the header button's job, and auditioning a list should not
            // yank the browser away on every selection.
            ui.selectedKey = key;
            ui.armedKey = key;
            defer(st);
            return;
        }
        if (tag === "fav") {
            // Toggle in place. The shortlist is the point of the button, so it has to
            // be reachable from any row without leaving the tab you are browsing.
            const at = ui.favourites.indexOf(key);
            if (at >= 0) ui.favourites.splice(at, 1);
            else ui.favourites.push(key);
            defer(st);
            return;
        }
        if (tag === "stop") {
            if (st.preview !== undefined && st.preview.key === key) stopPreview(st);
            defer(st);
            return;
        }
        if (tag === "play") {
            // Audition without arming, so browsing does not change what fire spawns.
            ui.selectedKey = key;
            preview(st, item);
            defer(st);
            return;
        }
    }

    // Nothing above claimed it. A ui.ts that emits an action handle() does not
    // know about looks exactly like a dead button, which is the failure this
    // whole migration exists to eliminate -- so it is always reported.
    log(`UNHANDLED ACTION "${action}" (open=${ui.open} tab=${ui.tab})`);
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function armSelected(st: PlayerState): void {
    const ui = st.ui;
    if (ui.selectedKey === "") {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(T.pickFirst), ui.player);
        return;
    }
    ui.armedKey = ui.selectedKey;
    setOpen(ui, false);
    defer(st);
}

function spawnSfx(st: PlayerState, entry: SfxEntry, at: mod.Vector | undefined): mod.SFX {
    const pos = at !== undefined ? at : ZERO;
    const sfx = mod.SpawnObject(entry.asset, pos, ZERO, ONE) as mod.SFX;
    if (at !== undefined && entry.dim === "3d") mod.PlaySound(sfx, st.ui.amp, pos, st.ui.rng);
    else mod.PlaySound(sfx, st.ui.amp, st.ui.player);
    track(st, sfx, entry.windowMs);
    return sfx;
}

function track(st: PlayerState, sfx: mod.SFX, windowMs: number): void {
    st.playing.push(sfx);
    Timers.setTimeout(() => {
        mod.StopSound(sfx);
        mod.UnspawnObject(sfx);
        const i = st.playing.indexOf(sfx);
        if (i >= 0) st.playing.splice(i, 1);
    }, windowMs);
}

/**
 * Stop the previous audition, so replaying a row does not stack.
 *
 * Holding a button in any real UI retriggers the same sound rather than layering
 * new copies of it. Eight clicks on PLAY in a second produced eight simultaneous
 * sounds, which is not a preview of anything.
 */
function stopPreview(st: PlayerState): void {
    const p = st.preview;
    if (p === undefined) return;
    st.preview = undefined;
    if (p.type === "screen") {
        const f = findScreenFx(p.id);
        if (f !== undefined) setScreenFx(st, f, false);
    } else if (p.type === "sfx") {
        const i = st.playing.indexOf(p.sfx);
        if (i >= 0) st.playing.splice(i, 1);
        mod.StopSound(p.sfx);
        mod.UnspawnObject(p.sfx);
    }
}

function preview(st: PlayerState, r: Row): void {
    stopPreview(st);
    if (r.type === "sfx") {
        const sfx = spawnSfx(st, r.entry, undefined);
        st.preview = { type: "sfx", sfx: sfx, key: rowKey(r) };
        return;
    }
    if (r.type === "screen") {
        const f = findScreenFx(r.id);
        if (f === undefined) return;
        const on = !isScreenOn(st, f);
        setScreenFx(st, f, on);
        st.preview = on ? { type: "screen", id: r.id, key: rowKey(r) } : undefined;
        mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.screenToggle, r.key, on ? T.onWord : T.offWord), st.ui.player);
        return;
    }
    spawnVfx(st, r, eyeFront(st));
}

function findScreenFx(id: string): ScreenFx | undefined {
    for (const f of SCREEN_FX) if (f.id === id) return f;
    return undefined;
}

const activeScreenFx: Record<string, boolean> = {};

function fxKey(st: PlayerState, f: ScreenFx): string {
    return st.ui.pid + "/" + f.id;
}

function isScreenOn(st: PlayerState, f: ScreenFx): boolean {
    return activeScreenFx[fxKey(st, f)] === true;
}

function setScreenFx(st: PlayerState, f: ScreenFx, on: boolean): void {
    mod.EnableScreenEffect(st.ui.player, f.effect, on);
    if (f.soldier !== undefined) mod.SetSoldierEffect(st.ui.player, f.soldier, on);
    const key = fxKey(st, f);
    if (on) activeScreenFx[key] = true;
    else delete activeScreenFx[key];
}

function eyeFront(st: PlayerState): mod.Vector {
    const p = st.ui.player;
    const facing = mod.Normalize(mod.GetSoldierState(p, mod.SoldierStateVector.GetFacingDirection));
    return mod.Add(mod.GetSoldierState(p, mod.SoldierStateVector.EyePosition), mod.Multiply(facing, 3));
}

// UNVERIFIED: mod.SpawnObject on an FX_ member returns `Any`; the cast to
// mod.VFX follows the same shape the SDK example uses for SFX and is inference.
function spawnVfx(st: PlayerState, r: Row, at: mod.Vector): void {
    if (r.type !== "spawn") return;
    const vfx = mod.SpawnObject(r.entry.asset, at, ZERO, ONE) as mod.VFX;
    mod.EnableVFX(vfx, true);
    mod.SetVFXScale(vfx, st.ui.scale);
    mod.SetVFXColor(vfx, mod.CreateVector(CONFIG.vfxColor[0], CONFIG.vfxColor[1], CONFIG.vfxColor[2]));
    st.spawned.push(vfx);
    if (st.spawned.length > CONFIG.maxSpawnedPerPlayer) {
        const oldest = st.spawned.shift();
        if (oldest !== undefined) mod.UnspawnObject(oldest);
    }
}

function undoLast(st: PlayerState): void {
    const v = st.spawned.pop();
    if (v === undefined) {
        mod.DisplayHighlightedWorldLogMessage(mod.Message(T.nothingToUndo), st.ui.player);
        return;
    }
    mod.EnableVFX(v, false);
    mod.UnspawnObject(v);
}

/**
 * Stop every sound this player has ringing, and leave the placed effects alone.
 *
 * DELETE ALL removes the VFX; nothing stopped the SFX, so a long audition kept
 * ringing over everything else. The tracked handles in st.playing are the only
 * sounds this mod owns -- a sound spawned by the game itself is not ours to touch.
 */
/**
 * Write every saved asset to the log, by its index-file name.
 *
 * The name is the point: the output is meant to be pasted back into a Portal editor
 * or looked up in index.d.ts, so it carries the enum member verbatim -- SFX_Alarm,
 * FX_Airburst_Incendiary_Detonation -- not the display name the menu shows.
 *
 * It goes out through logAlways, not log, so it still works with debug logging off.
 * An export the player can silence is not an export.
 */
function exportFavourites(st: PlayerState): void {
    const ui = st.ui;
    if (ui.favourites.length === 0) {
        logAlways("FAVOURITES: nothing to export");
        return;
    }
    logAlways("---- FAVOURITES (" + ui.favourites.length + ") ----");
    for (const key of ui.favourites) {
        const r = findRow(key);
        if (r === undefined) continue;
        // name (index file) | group | type
        logAlways(rowRawName(r) + " | " + rowCategory(r) + " | " + (r.type === "sfx" ? "SFX" : "VFX"));
    }
    logAlways("---- END FAVOURITES ----");
    mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.exportedN, ui.favourites.length), ui.player);
}

function stopAll(st: PlayerState): void {
    for (const s of st.playing) {
        mod.StopSound(s);
        mod.UnspawnObject(s);
    }
    const n = st.playing.length;
    st.playing.length = 0;
    log(`stop all: silenced ${n} sound(s)`);
    mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.stoppedN, n), st.ui.player);
}

function clearAll(st: PlayerState): void {
    for (const v of st.spawned) {
        mod.EnableVFX(v, false);
        mod.UnspawnObject(v);
    }
    st.spawned.length = 0;
    for (const f of SCREEN_FX) setScreenFx(st, f, false);
}

// --------------------------------------------------------------- portal gadget
//
// Control scheme:
//   AIM  (right mouse)  -> opens the menu
//   FIRE (left mouse)   -> spawns the armed asset at the raycast hit point, then closes
//   SELECT in the menu  -> arms the highlighted row and closes the menu
//
// There is deliberately no MENU button: aim is the only opener, so a click on the
// world never has a second way into the menu.

Events.OnPortalGadgetAimStart.subscribe((player: mod.Player) => {
    const st = ensure(player);
    if (st.ui.open) return;
    setOpen(st.ui, true);
    defer(st);
    log(`gadget aim: opening menu, tab=${st.ui.tab}`);
});

Events.OnPortalGadgetFireStart.subscribe((player: mod.Player) => {
    const st = ensure(player);
    if (st.ui.armedKey === "") {
        // The hint used to open the menu as well. That made fire a second opener, so
        // both triggers opened the menu and neither one read as "spawn" -- a player
        // with nothing armed who pulled the trigger expected a sound and got the
        // browser instead. The hint is enough; fire stays a pure spawn gesture.
        mod.DisplayHighlightedWorldLogMessage(mod.Message(T.armFirst), player);
        log("gadget fire: nothing armed (menu not opened)");
        return;
    }
    const facing = mod.Normalize(mod.GetSoldierState(player, mod.SoldierStateVector.GetFacingDirection));
    const start = mod.Add(mod.GetSoldierState(player, mod.SoldierStateVector.EyePosition), facing);
    setOpen(st.ui, false);
    defer(st);
    log(`gadget fire: armed=${st.ui.armedKey} tab=${st.ui.tab} scale=${st.ui.scale}`);
    mod.RayCast(player, start, mod.Add(start, mod.Multiply(facing, CONFIG.rayLength)));
});

Events.OnRayCastHit.subscribe((player: mod.Player, point: mod.Vector, _normal: mod.Vector) => {
    const st = states[mod.GetObjId(player)];
    if (st === undefined) return;
    const armed = findRow(st.ui.armedKey);
    if (armed === undefined) return;

    if (armed.type === "sfx") {
        spawnSfx(st, armed.entry, point);
    } else if (armed.type === "spawn") {
        spawnVfx(st, armed, point);
    } else {
        const f = findScreenFx(armed.id);
        if (f !== undefined) setScreenFx(st, f, !isScreenOn(st, f));
    }
    st.ui.spawnedCount = st.spawned.length;
    defer(st);
    log(`raycast hit: placed ${armed.type} ${armed.type === "screen" ? armed.id : armed.entry.name}, world total=${st.spawned.length}`);
});

Events.OnRayCastMissed.subscribe((player: mod.Player) => {
    mod.DisplayHighlightedWorldLogMessage(mod.Message(T.noSurface), player);
});
