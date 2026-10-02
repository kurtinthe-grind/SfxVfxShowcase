// Portal-gadget SFX/VFX browser.
import { Events } from "bf6-portal-utils/events";
import { Timers } from "bf6-portal-utils/timers";

import { SFX_CATALOG, SFX_CATEGORIES, SFX_PREFIXES, type SfxEntry, VFX_CATALOG, VFX_CATEGORIES, VFX_PREFIXES } from "./catalog";
import { CONFIG } from "./config";
import { debugEnabled, initLog, log, logAlways, setDebug } from "./diag";
import { packQrTexts } from "./qrexport";
import { applyTemplate, findTemplate, handleTesterAction, loadStartupMusic, newTesterState, playTemplate, removeTemplate, saveTemplate, stopTemplate, templateExportLine, templateKey } from "./tester";
import { T, TPL } from "./text.gen";
import { clickSound, playUiSound, UI_SOUND } from "./uisound";
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

interface Playing {
    readonly sfx: mod.SFX;
    timer: Timers.TimerID | null;
}

interface PlayerState {
    ui: PlayerUi;
    spawned: mod.VFX[];
    playing: Playing[];
    preview: PreviewState | undefined;
    building: boolean;
}

const states: Record<number, PlayerState> = {};

// Player-wide effects toggle state on the firing player.
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
    loadStartupMusic();
});

// Grant the gadget on every deployment so it survives death and respawn.
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    mod.AddEquipment(player, mod.Gadgets.Misc_PortalGadget);
    ensure(player);
    log(`deploy: player ${mod.GetObjId(player)} granted the portal gadget`);
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
        qrOpen: false,
        qrParts: [],
        qrPart: 0,
        qr: undefined,
        qrShown: -1,
    };
    const st: PlayerState = { ui: ui, spawned: [], playing: [], preview: undefined, building: false };
    states[pid] = st;
    renderLogged(st);
    return st;
}

function redraw(st: PlayerState): void {
    renderLogged(st);
}

// Batched render. A "render begin" with no "render end" means the game died mid-pass.
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

/** Single entry point for button actions. */
setActionHandler((ui, action) => {
    const st = states[mod.GetObjId(ui.player)];
    if (st !== undefined) handle(st, action);
});

/** The only place `ui.open` changes. Never call EnableUIInputMode by hand. */
function setOpen(ui: PlayerUi, open: boolean): void {
    if (ui.open === open) return;
    ui.open = open;
    if (!open) ui.qrOpen = false;
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

    if (action === "mtSave" && isTesterTab(ui.tab)) {
        const r = saveTemplate(ui.tab, ui.tester);
        if (r.added) ui.favourites.push(templateKey(r.tpl));
        playUiSound(ui.player, UI_SOUND.on);
        defer(st);
        return;
    }
    const sound = clickSound(action);
    if (sound !== undefined) playUiSound(ui.player, sound);

    if (action === "btnClose") {
        setOpen(ui, false);
        defer(st);
        return;
    }
    if (action === "tabSfx" || action === "tabVfx" || action === "tabFav" || action === "tabMusic" || action === "tabRadio") {
        ui.tab = action === "tabSfx" ? "sfx" : action === "tabVfx" ? "vfx" : action === "tabFav" ? "fav" : action === "tabMusic" ? "music" : "radio";
        ui.qrOpen = false;
        ui.group = 0;
        ui.railPage = 0;
        ui.page = 0;
        ui.selectedKey = "";
        defer(st);
        return;
    }
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
    if (ui.tab === "fav") {
            exportFavourites(st);
            return;
        }
        armSelected(st);
        return;
    }

    if (action === "btnQr") {
        if (ui.tab !== "fav" || ui.favourites.length === 0) return;
        ui.qrParts = packQrTexts(favouriteQrLines(st));
        ui.qrPart = 0;
        ui.qrOpen = ui.qrParts.length > 0;
        logQrText(ui);
        defer(st);
        return;
    }
    if (action === "btnQrPrev" || action === "btnQrNext") {
        const next = ui.qrPart + (action === "btnQrNext" ? 1 : -1);
        if (!ui.qrOpen || next < 0 || next >= ui.qrParts.length) return;
        ui.qrPart = next;
        logQrText(ui);
        defer(st);
        return;
    }
    if (action === "btnQrClose") {
        ui.qrOpen = false;
        defer(st);
        return;
    }

    if (action === "btnDebug") {
        setDebug(debugEnabled() === false);
        defer(st);
        return;
    }
    // rail<group> selects a group; "c<row>" is accepted for legacy actions.
    if (action.slice(0, 4) === "rail" || (action.charAt(0) === "c" && action.length > 1)) {
        const body = action.slice(0, 4) === "rail" ? action.slice(4) : action.slice(1);
        const group = parseInt(body, 10);
        if (isNaN(group) || group < 0) return;
        ui.group = group;
        ui.page = 0;
        defer(st);
        return;
    }

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

    // Row actions: r<index>_<tag>.
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
                stopTemplate(ui.tester, ui.player, t);
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
        if (tag === "sel") {
            // One click arms and leaves the menu open.
            ui.selectedKey = key;
            ui.armedKey = key;
            defer(st);
            return;
        }
        if (tag === "fav") {
            const at = ui.favourites.indexOf(key);
            if (at >= 0) ui.favourites.splice(at, 1);
            else ui.favourites.push(key);
            playUiSound(ui.player, at >= 0 ? UI_SOUND.off : UI_SOUND.on);
            defer(st);
            return;
        }
        if (tag === "stop") {
            if (st.preview !== undefined && st.preview.key === key) stopPreview(st);
            defer(st);
            return;
        }
        if (tag === "play") {
            // Audition without arming.
            ui.selectedKey = key;
            preview(st, item);
            defer(st);
            return;
        }
    }

    // Unclaimed actions are logged because they mean a dead button.
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

function spawnSfx(st: PlayerState, entry: SfxEntry, at: mod.Vector, onlyMe: boolean): mod.SFX {
    const sfx = mod.SpawnObject(entry.asset, at, ZERO, ONE) as mod.SFX;
    if (entry.dim === "2d") mod.PlaySound(sfx, st.ui.amp, st.ui.player);
    else if (onlyMe) mod.PlaySound(sfx, st.ui.amp, at, st.ui.rng, st.ui.player);
    else mod.PlaySound(sfx, st.ui.amp, at, st.ui.rng);
    track(st, sfx, entry.windowMs);
    return sfx;
}

function track(st: PlayerState, sfx: mod.SFX, windowMs: number): void {
    const p: Playing = { sfx: sfx, timer: null };
    p.timer = Timers.setTimeout(() => {
        p.timer = null;
        untrack(st, sfx);
    }, windowMs);
    st.playing.push(p);
    if (st.playing.length > CONFIG.maxSoundsPerPlayer) {
        const oldest = st.playing[0];
        untrack(st, oldest.sfx);
    }
}

function untrack(st: PlayerState, sfx: mod.SFX): void {
    let i = -1;
    for (let k = 0; k < st.playing.length; k++) if (st.playing[k].sfx === sfx) i = k;
    if (i < 0) return;
    const p = st.playing[i];
    st.playing.splice(i, 1);
    if (p.timer !== null) Timers.clear(p.timer);
    mod.StopSound(sfx);
    mod.UnspawnObject(sfx);
}

function stopPreview(st: PlayerState): void {
    const p = st.preview;
    if (p === undefined) return;
    st.preview = undefined;
    if (p.type === "screen") {
        const f = findScreenFx(p.id);
        if (f !== undefined) setScreenFx(st, f, false);
    } else if (p.type === "sfx") {
        untrack(st, p.sfx);
    }
}

function preview(st: PlayerState, r: Row): void {
    stopPreview(st);
    if (r.type === "sfx") {
        const sfx = spawnSfx(st, r.entry, eyeFront(st), true);
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

// UNVERIFIED: SpawnObject on FX_ returns `Any`; the VFX cast is inference.
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

/** Exports saved assets by index-file name through logAlways. */
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
        if (r.type === "sfx") logAlways(rowRawName(r) + " | " + rowCategory(r) + " | SFX | " + soundLength(r.entry));
        else logAlways(rowRawName(r) + " | " + rowCategory(r) + " | VFX");
    }
    for (const key of ui.favourites) {
        const t = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
        if (t !== undefined) logAlways(templateExportLine(t));
    }
    logAlways("---- END FAVOURITES ----");
    mod.DisplayHighlightedWorldLogMessage(mod.Message(TPL.exportedN, ui.favourites.length), ui.player);
}

function soundLength(e: SfxEntry): string {
    if (e.kind === "loop") return "LOOP";
    return e.lengthText !== "" ? e.lengthText : "?";
}

function favouriteQrLines(st: PlayerState): string[] {
    const ui = st.ui;
    const lines: string[] = [];
    for (const key of ui.favourites) {
        const r = findRow(key);
        if (r !== undefined) lines.push(rowRawName(r));
    }
    for (const key of ui.favourites) {
        const t = key.startsWith("tpl") ? findTemplate(ui.tester, key) : undefined;
        if (t !== undefined) lines.push(templateExportLine(t));
    }
    return lines;
}

function logQrText(ui: PlayerUi): void {
    const text = ui.qrParts[ui.qrPart];
    if (text !== undefined) log(`QR TEXT ${ui.qrPart + 1}/${ui.qrParts.length}: ${JSON.stringify(text)}`);
}

function stopAll(st: PlayerState): void {
    const n = st.playing.length;
    while (st.playing.length > 0) untrack(st, st.playing[0].sfx);
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

// Gadget controls: aim opens, fire spawns, SELECT arms. No MENU button; aim is the only opener.
Events.OnPortalGadgetAimStart.subscribe((player: mod.Player) => {
    const st = ensure(player);
    if (st.ui.open) return;
    setOpen(st.ui, true);
    playUiSound(player, UI_SOUND.open);
    defer(st);
    log(`gadget aim: opening menu, tab=${st.ui.tab}`);
});

Events.OnPortalGadgetFireStart.subscribe((player: mod.Player) => {
    const st = ensure(player);
    if (st.ui.armedKey === "") {
        // Fire never opens the menu; it stays a pure spawn gesture.
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
    if (armed === undefined || armed.type === "tpl") return;

    if (armed.type === "sfx") {
        spawnSfx(st, armed.entry, point, false);
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
