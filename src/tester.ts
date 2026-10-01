// MUSIC / RADIO tester: per-player state, the fields the tester panel binds to,
// and the mt* actions that make the music calls.
//
// Tier 0 (types_original/mod/index.d.ts): LoadMusic(MusicPackages),
// PlayMusic(MusicEvents, Player), SetMusicParam(MusicParams, number, Player).
// The package/event/param tables are generated from those enums by
// tools/gen-music.mjs, so nothing here names a music member by hand except the
// four Radio_* transport events, which are looked up by name and checked.
//
// The engine cannot be asked what is playing or what a parameter is set to, so
// the panel shows what was SENT: our values and the last call. Every call uses
// the player overload -- a tester must never play music to the whole lobby.

import { MUSIC_PACKAGES, PARAM_SLOTS, type MusicEventSpec, type MusicPackageSpec, type MusicParamSpec } from "./music.gen";
import { T, TPL } from "./text.gen";
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

function radioEvent(name: string): MusicEventSpec {
    for (const e of RADIO.events) if (e.name === name) return e;
    throw new Error("radio event missing from music.gen.ts: " + name);
}
const RADIO_PLAY = radioEvent("Radio_Play");
const RADIO_NEXT = radioEvent("Radio_NextQueuedTrack");
const RADIO_CLEAR = radioEvent("Radio_ClearQueue");

export interface TesterState {
    /** Index into MUSIC_TAB. */
    pkg: number;
    /** Selected event index, per MUSIC_TAB package. */
    evt: number[];
    /** Last value set per MusicParams name, amplitudes included. */
    values: Record<string, number>;
    /** The last call sent, as on-screen text. */
    last: mod.Message | undefined;
}

export function newTesterState(): TesterState {
    const values: Record<string, number> = {};
    for (const p of MUSIC_PACKAGES) {
        values[p.amp.name] = p.amp.def;
        for (const x of p.params) values[x.name] = x.def;
    }
    return { pkg: 0, evt: MUSIC_TAB.map(() => 0), values: values, last: undefined };
}

/** Called once from OnGameModeStarted: the docs advise loading early. */
export function loadAllMusic(): void {
    for (const p of MUSIC_TAB) mod.LoadMusic(p.pkg);
    mod.LoadMusic(RADIO.pkg);
}

function current(tab: TesterTab, st: TesterState): MusicPackageSpec {
    return tab === "radio" ? RADIO : MUSIC_TAB[st.pkg];
}

function round2(v: number): number {
    return Math.round(v * 100) / 100;
}

function sendParam(player: mod.Player, st: TesterState, p: MusicParamSpec): void {
    const v = st.values[p.name];
    mod.SetMusicParam(p.param, v, player);
    st.last = mod.Message(TPL.mtCallParam, p.key, v);
}

function sendEvent(player: mod.Player, st: TesterState, event: mod.MusicEvents, key: string): void {
    mod.PlayMusic(event, player);
    st.last = mod.Message(TPL.mtCallPlay, key);
}

function stepParam(player: mod.Player, st: TesterState, p: MusicParamSpec, dir: number): void {
    const v = st.values[p.name] + dir * p.step;
    st.values[p.name] = round2(Math.min(p.max, Math.max(p.min, v)));
    sendParam(player, st, p);
}

/**
 * Handles one mt* action. Returns false for an action it does not know, so the
 * caller's UNHANDLED ACTION log still fires for a misrouted button.
 */
export function handleTesterAction(tab: TesterTab, st: TesterState, player: mod.Player, action: string): boolean {
    const pkg = current(tab, st);
    const radio = tab === "radio";

    if (action === "mtPkgPrev" || action === "mtPkgNext") {
        if (radio) return true;
        const n = MUSIC_TAB.length;
        st.pkg = (st.pkg + (action === "mtPkgNext" ? 1 : n - 1)) % n;
        return true;
    }
    if (action === "mtPrev" || action === "mtNext") {
        if (radio) {
            const e = action === "mtNext" ? RADIO_NEXT : RADIO_CLEAR;
            sendEvent(player, st, e.event, e.key);
            return true;
        }
        const n = pkg.events.length;
        st.evt[st.pkg] = (st.evt[st.pkg] + (action === "mtNext" ? 1 : n - 1)) % n;
        return true;
    }
    if (action === "mtPlay") {
        // Re-send everything first, so what plays always matches the panel.
        for (const p of pkg.params) sendParam(player, st, p);
        sendParam(player, st, pkg.amp);
        const e = radio ? RADIO_PLAY : pkg.events[st.evt[st.pkg]];
        sendEvent(player, st, e.event, e.key);
        return true;
    }
    if (action === "mtStop") {
        sendEvent(player, st, pkg.stop, pkg.stopKey);
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

/** Field values for the tester nodes in scene.json (the `f` scope). */
export function testerFields(tab: TesterTab, st: TesterState): Scope {
    const pkg = current(tab, st);
    const radio = tab === "radio";
    const evt = pkg.events[st.evt[st.pkg]];
    const f: Scope = {
        mtTitle: mod.Message(radio ? T.mtCardRadio : T.mtCardTrack),
        mtPkgArrows: radio ? "0" : "1",
        mtPkg: mod.Message(TPL.mtPackageOf, pkg.key),
        mtEvent: mod.Message(radio ? T.mtRadioLine : evt.key),
        mtEventIdx: radio ? mod.Message(T.logEmpty) : mod.Message(TPL.mtTrackOf, st.evt[st.pkg] + 1, pkg.events.length),
        mtPrevLabel: mod.Message(radio ? T.mtClearQueue : T.mtPrev),
        mtPlayLabel: mod.Message(T.mtPlay),
        mtStopLabel: mod.Message(T.mtStop),
        mtNextLabel: mod.Message(radio ? T.mtNextTrack : T.mtNext),
        mtParamNote: mod.Message(pkg.params.length === 0 ? T.mtNoParams : T.mtNoteParams),
        mtVol: mod.Message(TPL.num1, st.values[pkg.amp.name]),
        mtLast: st.last ?? mod.Message(T.mtNothingSent),
    };
    for (let i = 0; i < PARAM_SLOTS; i++) {
        const p = pkg.params[i];
        f["mtP" + i + "On"] = p === undefined ? "0" : "1";
        f["mtP" + i + "Label"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.mtParamLabel, p.key);
        f["mtP" + i + "Val"] = p === undefined ? mod.Message(T.logEmpty) : mod.Message(TPL.num1, st.values[p.name]);
    }
    return f;
}
