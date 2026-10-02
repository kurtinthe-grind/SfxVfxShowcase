// Shared console.log sink. console.log is a QuickJS global, not a mod.* API.
// Nothing reads PortalLog.txt here; the log exists so users can paste it.
import { Logging } from "bf6-portal-utils/logging";
import { UI } from "bf6-portal-utils/ui";

export const logging = new Logging("SfxVfxShowcase");

let installed = false;

/** Diagnostics reach the console only when the DEBUG button turns them on. */
let debug = false;

export function debugEnabled(): boolean {
    return debug;
}

const sink = (text: string): void => console.log(text);

function applyUiLogLevel(): void {
    UI.setLogging(sink, debug ? Logging.LogLevel.Debug : Logging.LogLevel.Warning, true);
}

export function setDebug(on: boolean): void {
    debug = on;
    if (installed) applyUiLogLevel();
}

export function initLog(): void {
    if (installed) return;
    installed = true;
    logging.setLogging(sink, Logging.LogLevel.Debug, true);
    applyUiLogLevel();
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
