// MUSIC / RADIO tester: per-player state, the fields the tester panel binds to,
// and the mt* actions that make the music calls.
//
// Tier 0 (types_original/mod/index.d.ts): LoadMusic / UnloadMusic(MusicPackages),
// PlayMusic(MusicEvents[, Player]), SetMusicParam(MusicParams, number[, Player]).
// The package/event/param tables are generated from those enums by
// tools/gen-music.mjs, so nothing here names a music member by hand except the
// four Radio_* transport events, which are looked up by name and checked.
//
// NO MUSIC ON PORTAL SANDBOX. Scripted music plays nothing on the Portal Sandbox
// map, on any build, with calls copied verbatim from the SDK docs and
// CustomConquest (probe/MusicProbe.ts). Every other map plays it (confirmed in
// game, 2026-10-01). Four tester builds were spent blaming loading and timing
// before the map was isolated, so test music on any map but Portal Sandbox.
//
// LOADING. Official modes load exactly one package at the start, so only Core
// is loaded at start and LOAD switches packages exclusively: unload the current
// one, load the one on screen. Loading is global, not per player.
//
// LOAD TIME. The SDK docs say to "allow a few seconds of time for the music to
// load in", so every call made within CONFIG.musicLoadMs of a LoadMusic is held
// and sent, in click order, once that time has passed.
//
// TARGET. ME uses the player overloads, EVERYONE the global ones, so a run in
// game can tell whether the per-player calls are what is silent.
//
// The engine cannot be asked what is playing or what a parameter is set to, so
// the panel shows what was SENT, and every call is written to the log.

import { Timers } from "bf6-portal-utils/timers";

import { CONFIG } from "./config";
import { log } from "./diag";
import { MUSIC_PACKAGES, PARAM_SLOTS, type MusicEventSpec, type MusicPackageSpec, type MusicParamSpec } from "./music.gen";
import { PALETTE } from "./scene.gen";
import { RADIO_TEXT, T, TPL } from "./text.gen";
import type { Scope } from "./ui";

export type TesterTab = "music" | "radio";

function pkgNamed(name: string): MusicPackageSpec {
    for (const p of MUSIC_PACKAGES) if (p.name === name) return p;
    // gen-music.mjs fails the build if any of these four is missing.
    throw new Error("music package missing from music.gen.ts: " + name);
}

/** The MUSIC tab cycles these, in this order. Radio has its own tab. */
const MUSIC_TAB: readonly MusicPackageSpec[] = [pkgNamed("Core"), pkgNamed("BR"), pkgNamed("Gauntlet")];
const RADIO = pkgNamed("Radio");
/** Loaded at game-mode start, as the official examples do. */
const STARTUP = MUSIC_TAB[0];

/**
 * Where each MUSIC package's track selector starts: the loud one-shots the
 * reference mods play (CustomConquest: Core_LastPhaseBegin, AcePursuit:
 * BR_InsertionJump). Index 0 of Core is Core_Deploy_Loop, a "quiet and ambient"
 * deploy-screen loop, too quiet to tell whether music works at all.
 */
const DEFAULT_EVENT: Readonly<Record<string, string>> = {
    Core: "Core_LastPhaseBegin",
    BR: "BR_InsertionJump",
    Gauntlet: "Gauntlet_Deploy",
};

function defaultEventIndex(p: MusicPackageSpec): number {
    const want = DEFAULT_EVENT[p.name];
    for (let i = 0; i < p.events.length; i++) if (p.events[i].name === want) return i;
    return 0;
}

function radioEvent(name: string): MusicEventSpec {
    for (const e of RADIO.events) if (e.name === name) return e;
    throw new Error("radio event missing from music.gen.ts: " + name);
}
const RADIO_PLAY = radioEvent("Radio_Play");
const RADIO_NEXT = radioEvent("Radio_NextQueuedTrack");
const RADIO_CLEAR = radioEvent("Radio_ClearQueue");

const RADIO_CHANNELS = [T.radioCh0, T.radioCh1, T.radioCh2, T.radioCh3, T.radioCh4, T.radioCh5, T.radioCh6];
const RADIO_BIOMES = [T.radioBiome0, T.radioBiome1, T.radioBiome2, T.radioBiome3, T.radioBiome4, T.radioBiome5, T.radioBiome6];

// Tracks per station, numbered from 0. SDK docs (gameplay_logic.html,
// QueueTrackNumber), "as of Season 3". Index = Radio_Channel; channel 4 is
// per biome. Used to wrap the track number after QUEUE TRACK.
const RADIO_TRACKS = [17, 18, 10, 2, 0, 32, 15];
const RADIO_BIOME_TRACKS = [18, 16, 16, 19, 18, 2, 18];

/** The one package currently loaded. Music loading is global, so this is too. */
let loaded: MusicPackageSpec | undefined;
/** Date.now() of the last LoadMusic (bf6-portal-utils timers use the same clock). */
let loadedAt = 0;
/** Calls held until the current package has had CONFIG.musicLoadMs to load. */
const held: (() => void)[] = [];
let flushScheduled = false;

function loading(): boolean {
    return loaded !== undefined && Date.now() - loadedAt < CONFIG.musicLoadMs;
}

/** Runs `send` now, or once the package being loaded has had time to load. */
function whenLoaded(send: () => void): void {
    if (!loading()) {
        send();
        return;
    }
    held.push(send);
    if (flushScheduled) return;
    flushScheduled = true;
    const wait = CONFIG.musicLoadMs - (Date.now() - loadedAt);
    log("music: holding calls " + wait + "ms while " + (loaded === undefined ? "?" : loaded.name) + " loads");
    Timers.setTimeout(() => {
        flushScheduled = false;
        const run = held.splice(0, held.length);
        for (const f of run) f();
    }, wait);
}

export interface TesterState {
    /** Index into MUSIC_TAB. */
    pkg: number;
    /** Selected event index, per MUSIC_TAB package. */
    evt: number[];
    /** Last value set per MusicParams name, amplitudes included. */
    values: Record<string, number>;
    /** The last call sent, as on-screen text. */
    last: mod.Message | undefined;
    /** false = player overloads (ME), true = global overloads (EVERYONE). */
    toAll: boolean;
    /** Tracks queued since the last CLEAR QUEUE, in order. The engine cannot be asked. */
    queue: RadioPick[];
    /** Saved templates, in save order. Their keys ("tpl" + n) sit in the player's favourites. */
    templates: Template[];
    /** Number for the next template; never reused within a match. */
    nextTemplate: number;
}

export interface RadioPick {
    ch: number;
    biome: number;
    track: number;
}

export function newTesterState(): TesterState {
    const values: Record<string, number> = {};
    for (const p of MUSIC_PACKAGES) {
        values[p.amp.name] = p.amp.def;
        for (const x of p.params) values[x.name] = x.def;
    }
    return { pkg: 0, evt: MUSIC_TAB.map(defaultEventIndex), values: values, last: undefined, toAll: false, queue: [], templates: [], nextTemplate: 1 };
}

/** Called once from OnGameModeStarted: the docs advise loading early. */
export function loadStartupMusic(): void {
    // The SDK doc's example (gameplay_logic.html, Music System Summary), call
    // for call: LoadMusic, then the package's amplitude, in OnGameModeStarted.
    mod.LoadMusic(STARTUP.pkg);
    loaded = STARTUP;
    loadedAt = Date.now();
    log("music: LoadMusic(" + STARTUP.name + ") at game-mode start");
    mod.SetMusicParam(STARTUP.amp.param, STARTUP.amp.def);
    log("music: SetMusicParam(" + STARTUP.amp.name + ", " + STARTUP.amp.def + ") for=everyone at game-mode start");
}

function current(tab: TesterTab, st: TesterState): MusicPackageSpec {
    return tab === "radio" ? RADIO : MUSIC_TAB[st.pkg];
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function who(st: TesterState): string {
    return st.toAll ? "everyone" : "me";
}

function load(st: TesterState, pkg: MusicPackageSpec, redraw: () => void): void {
    // Re-sending LoadMusic for the loaded package is never useful, and in the
    // second in-game run it landed in the middle of a test.
    if (loaded === pkg) {
        log("music: " + pkg.name + " already loaded, LoadMusic not re-sent");
        return;
    }
    if (loaded !== undefined) {
        mod.UnloadMusic(loaded.pkg);
        log("music: UnloadMusic(" + loaded.name + ")");
    }
    mod.LoadMusic(pkg.pkg);
    loaded = pkg;
    loadedAt = Date.now();
    st.last = mod.Message(TPL.mtCallLoad, pkg.key);
    log("music: LoadMusic(" + pkg.name + ")");
    // Repaint when loading ends, so the button turns from LOADING to LOADED.
    whenLoaded(redraw);
}

function sendParam(player: mod.Player, st: TesterState, p: MusicParamSpec): void {
    const v = st.values[p.name];
    if (st.toAll) mod.SetMusicParam(p.param, v);
    else mod.SetMusicParam(p.param, v, player);
    st.last = mod.Message(TPL.mtCallParam, p.key, v);
    log("music: SetMusicParam(" + p.name + ", " + v + ") for=" + who(st));
}

function sendEvent(player: mod.Player, st: TesterState, event: mod.MusicEvents, name: string, key: string): void {
    if (st.toAll) mod.PlayMusic(event);
    else mod.PlayMusic(event, player);
    st.last = mod.Message(TPL.mtCallPlay, key);
    const pkgNote = loaded === undefined ? "nothing loaded" : "loaded=" + loaded.name;
    log("music: PlayMusic(" + name + ") for=" + who(st) + " " + pkgNote);
}

function stepParam(player: mod.Player, st: TesterState, p: MusicParamSpec, dir: number): void {
    const v = st.values[p.name] + dir * p.step;
    st.values[p.name] = round2(Math.min(p.max, Math.max(p.min, v)));
    // Sending the queue param queues a track: the stepper only picks the number,
    // QUEUE TRACK sends it.
    if (!p.queues) whenLoaded(() => sendParam(player, st, p));
}

function queueParam(pkg: MusicPackageSpec): MusicParamSpec | undefined {
    for (const p of pkg.params) if (p.queues) return p;
    return undefined;
}

function radioChannel(st: TesterState): number {
    return Math.round(st.values["Radio_Channel"] ?? 0);
}

function radioBiome(st: TesterState): number {
    return Math.round(st.values["Radio_Biome"] ?? 0);
}

function stationKey(ch: number, biome: number): string {
    return ch === 4 ? pickKey(RADIO_BIOMES, biome) : pickKey(RADIO_CHANNELS, ch);
}

/**
 * True when tracks are queued and the selected station is not theirs. The
 * channel only applies to tracks queued after it is set (SDK docs: "the
 * channel from which you will be queueing tracks"), so PLAY and NEXT TRACK
 * would keep playing the queued station.
 */
function queueIsStale(st: TesterState): boolean {
    const q = st.queue[st.queue.length - 1];
    if (q === undefined) return false;
    const ch = radioChannel(st);
    return ch !== q.ch || (ch === 4 && radioBiome(st) !== q.biome);
}

/**
 * Records the track QUEUE TRACK just sent, then moves the number on to the
 * station's next track (back to 0 after its last), so pressing QUEUE TRACK
 * again queues a different song instead of the same one.
 */
function noteQueued(st: TesterState, q: MusicParamSpec): void {
    const ch = radioChannel(st);
    const biome = radioBiome(st);
    const track = st.values[q.name];
    st.queue.push({ ch: ch, biome: biome, track: track });
    const n = (ch === 4 ? RADIO_BIOME_TRACKS[biome] : RADIO_TRACKS[ch]) ?? q.max + 1;
    st.values[q.name] = track + 1 < n ? Math.min(q.max, track + 1) : q.min;
}

function queueLine(st: TesterState): mod.Message {
    const q = st.queue[st.queue.length - 1];
    if (q === undefined) return mod.Message(T.mtQueueEmpty);
    return mod.Message(TPL.mtQueueCount, st.queue.length, stationKey(q.ch, q.biome), q.track);
}

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

export function templateExportLine(t: Template): string {
    return (t.kind === "music" ? "MUSIC" : "RADIO") + " TEMPLATE " + t.n;
}

/**
 * The package `action` needs loaded, when it is not: PLAY and STOP, and on the
 * radio tab the queue buttons, which only drive the loaded package. undefined
 * when the click may go ahead. A package still loading counts as loaded: its
 * calls are held until it has had time to load (whenLoaded).
 */
export function needsLoad(tab: TesterTab, st: TesterState, action: string): MusicPackageSpec | undefined {
    const pkg = current(tab, st);
    return loaded !== pkg && gated(tab, action) ? pkg : undefined;
}

function gated(tab: TesterTab, action: string): boolean {
    if (action === "mtPlay" || action === "mtStop") return true;
    return tab === "radio" && (action === "mtPrev" || action === "mtNext" || action === "mtQueue");
}

/**
 * Handles one mt* action. Returns false for an action it does not know, so the
 * caller's UNHANDLED ACTION log still fires for a misrouted button.
 */
export function handleTesterAction(tab: TesterTab, st: TesterState, player: mod.Player, action: string, redraw: () => void): boolean {
    const pkg = current(tab, st);
    const radio = tab === "radio";

    if (action === "mtPkgPrev" || action === "mtPkgNext") {
        if (radio) return true;
        const n = MUSIC_TAB.length;
        st.pkg = (st.pkg + (action === "mtPkgNext" ? 1 : n - 1)) % n;
        return true;
    }
    if (action === "mtLoad") {
        load(st, pkg, redraw);
        return true;
    }
    if (action === "mtTarget") {
        st.toAll = !st.toAll;
        return true;
    }
    if (action === "mtQueue") {
        const q = queueParam(pkg);
        if (q === undefined) return false;
        whenLoaded(() => {
            sendParam(player, st, q);
            noteQueued(st, q);
            redraw();
        });
        return true;
    }
    if (action === "mtPrev" || action === "mtNext") {
        if (radio) {
            const e = action === "mtNext" ? RADIO_NEXT : RADIO_CLEAR;
            whenLoaded(() => {
                sendEvent(player, st, e.event, e.name, e.key);
                if (e === RADIO_CLEAR) st.queue = [];
                redraw();
            });
            return true;
        }
        const n = pkg.events.length;
        st.evt[st.pkg] = (st.evt[st.pkg] + (action === "mtNext" ? 1 : n - 1)) % n;
        return true;
    }
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
    if (action === "mtStop") {
        whenLoaded(() => {
            sendEvent(player, st, pkg.stop, pkg.name + "_Stop", pkg.stopKey);
            redraw();
        });
        return true;
    }
    if (action === "mtVolDown" || action === "mtVolUp") {
        stepParam(player, st, pkg.amp, action === "mtVolUp" ? 1 : -1);
        return true;
    }
    // mtP<slot>Down / mtP<slot>Up
    const m = /^mtP(\d)(Down|Up)$/.exec(action);
    if (m !== null) {
        const p = pkg.params[parseInt(m[1], 10)];
        // A hidden row cannot be clicked; reaching here means a stale widget.
        if (p === undefined) return false;
        stepParam(player, st, p, m[2] === "Up" ? 1 : -1);
        return true;
    }
    return false;
}

function pickKey(keys: readonly string[], v: number): string {
    const k = keys[Math.round(v)];
    return k === undefined ? T.logEmpty : k;
}

/** Field values for the tester nodes in scene.json (the `f` scope). */
export function testerFields(tab: TesterTab, st: TesterState): Scope {
    const pkg = current(tab, st);
    const radio = tab === "radio";
    const isLoaded = loaded === pkg;
    const evt = pkg.events[st.evt[st.pkg]];
    const q = queueParam(pkg);
    const ch = st.values["Radio_Channel"] ?? 0;
    const biome = st.values["Radio_Biome"] ?? 0;
    const f: Scope = {
        mtTitle: mod.Message(radio ? T.mtCardRadio : T.mtCardTrack),
        mtPkgArrows: radio ? "0" : "1",
        mtPkg: mod.Message(TPL.mtPackageOf, pkg.key),
        mtEvent: mod.Message(radio ? T.mtRadioLine : evt.key),
        mtEventIdx: radio ? queueLine(st) : mod.Message(isLoaded ? TPL.mtTrackOf : TPL.mtTrackUnloaded, st.evt[st.pkg] + 1, pkg.events.length),
        mtEventDesc: mod.Message(radio ? (queueIsStale(st) ? T.mtQueueStale : T.mtRadioHelp) : evt.desc),
        mtPrevLabel: mod.Message(radio ? T.mtClearQueue : T.mtPrev),
        mtPlayLabel: mod.Message(T.mtPlay),
        mtStopLabel: mod.Message(T.mtStop),
        mtNextLabel: mod.Message(radio ? T.mtNextTrack : T.mtNext),
        mtParamNote: radio ? mod.Message(TPL.mtRadioNote, ch, pickKey(RADIO_CHANNELS, ch), pickKey(RADIO_BIOMES, biome)) : mod.Message(pkg.params.length === 0 ? T.mtNoParams : T.mtNoteParams),
        mtVol: mod.Message(TPL.num1, st.values[pkg.amp.name]),
        mtLast: st.last ?? mod.Message(T.mtNothingSent),
        mtLoadLabel: mod.Message(isLoaded ? (loading() ? TPL.mtLoadingOf : TPL.mtLoadedOf) : TPL.mtLoadOf, pkg.key),
        mtLoadBg: isLoaded ? PALETTE.green : PALETTE.amber,
        mtTargetLabel: mod.Message(st.toAll ? T.mtTargetAll : T.mtTargetMe),
        mtTargetBg: st.toAll ? PALETTE.hot : PALETTE.row,
        mtQueueOn: q === undefined ? "0" : "1",
        mtQueueLabel: q === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.mtQueueOf, st.values[q.name]),
        // Greyed out while the package on screen is not loaded (see needsLoad).
        mtPlayBg: isLoaded ? PALETTE.green : PALETTE.line,
        mtStopBg: isLoaded ? PALETTE.redDim : PALETTE.line,
        mtSkipBg: radio && !isLoaded ? PALETTE.line : PALETTE.row,
        mtQueueBg: isLoaded ? PALETTE.violet : PALETTE.line,
        mtGateInk: isLoaded ? "#FFFFFF" : PALETTE.faint,
        mtSkipInk: radio && !isLoaded ? PALETTE.faint : "#FFFFFF",
    };
    for (let i = 0; i < PARAM_SLOTS; i++) {
        const p = pkg.params[i];
        f["mtP" + i + "On"] = p === undefined ? "0" : "1";
        f["mtP" + i + "Label"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.mtParamLabel, p.key);
        f["mtP" + i + "Val"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.num1, st.values[p.name]);
        f["mtP" + i + "Desc"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(p.desc);
    }
    return f;
}
