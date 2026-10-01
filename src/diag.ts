// The mod's console.log sink, shared by index.ts and ui.ts.
//
// This lives in its own module so ui.ts can report a missing text key without
// importing index.ts, which would be circular.
//
// console.log is a QuickJS global provided by Portal, not a mod.* API, so it does
// not appear in index.d.ts. It is used as a logging sink by
// bf6-portal-utils/logging itself, and console.error appears in modlib_original.
// tsconfig sets lib:["ES2020","DOM"], which is what makes it typecheck.
//
// AGENT.md §9: PortalLog.txt is user-gated. Nothing here reads it -- the log exists
// so the user can paste it into chat.

import { Logging } from "bf6-portal-utils/logging";
import { UI } from "bf6-portal-utils/ui";

export const logging = new Logging("SfxVfxShowcase");

let installed = false;

/**
 * Whether diagnostics reach the console. On by default: the controller crash
 * investigation needs a log from the very first menu open, before anyone can
 * reach the DEBUG button. The button still turns it off.
 */
let debug = true;

export function debugEnabled(): boolean {
    return debug;
}

export function setDebug(on: boolean): void {
    debug = on;
}

export function initLog(): void {
    if (installed) return;
    installed = true;
    const sink = (text: string): void => console.log(text);
    logging.setLogging(sink, Logging.LogLevel.Debug, true);
    UI.setLogging(sink, Logging.LogLevel.Debug, true);
}

export function log(text: string): void {
    if (!debug) return;
    logging.log(text, Logging.LogLevel.Debug);
}

export function logAlways(text: string): void {
    logging.log(text, Logging.LogLevel.Debug);
}

const reported = new Set<string>();
export function reportMissingKey(literal: string, where: string): void {
    const k = where + "|" + literal;
    if (reported.has(k)) return;
    reported.add(k);
    log(`MISSING TEXT KEY: ${JSON.stringify(literal)} from ${where} -- add it to tools/gen-text.mjs`);
}
