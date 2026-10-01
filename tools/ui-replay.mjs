// Replays dist/bundle.ts in Node against a recording stand-in for the global
// `mod`, so tests can see every engine call the shipping bundle makes.
//
// WHY: on 2026-10-01 the game client started crashing when the menu opened. The
// script itself never errored -- the log ended at "render end" -- because the
// engine died on ~245 widgets created in one tick. Nothing in the browser preview
// or tsc can see that. This replay can: it runs the real bundle through the same
// event sequence the game does and records what reaches the engine.
//
// The stand-in only models what the bundle reads back: vectors, object ids,
// Equals, Message, widget lookup by name and IsType for the player. Every other
// mod.* call is recorded and returns undefined. Timers in bf6-portal-utils run on
// Date.now(). The replay swaps Date.now() for a virtual clock that each tick
// advances by exactly TICK_MS, so timer-driven behaviour (widget batches, the
// music load gate) is deterministic and fast. Real-time ticks were ~45 ms each
// on Windows instead of 16, which made phase timing drift between machines.

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");
const require = createRequire(resolve(ROOT, "package.json"));
const ts = require("typescript");

const TICK_MS = 16;

/** strings.json value -> every key with that value (several can read "RADIO"). */
function reverseStrings() {
    const strings = JSON.parse(readFileSync(resolve(ROOT, "dist", "bundle.strings.json"), "utf8"));
    const byText = {};
    for (const [k, v] of Object.entries(strings)) if (typeof v === "string") (byText[v] ??= []).push(k);
    return byText;
}

/**
 * Runs `source` (bundle TypeScript) and returns a session to drive it.
 * Each replay gets its own temp module so two variants can run in one process.
 */
export async function replay(source) {
    const js = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;
    const dir = mkdtempSync(join(tmpdir(), "sfx-replay-"));
    const file = join(dir, "bundle.mjs");
    writeFileSync(file, js);

    const calls = [];
    const logs = [];
    let phase = "boot";

    const special = {
        CreateVector: (x, y, z) => ({ v: [x, y, z] }),
        XComponentOf: (v) => v.v[0],
        YComponentOf: (v) => v.v[1],
        ZComponentOf: (v) => v.v[2],
        GetObjId: (o) => (o && o.id !== undefined ? o.id : 0),
        Equals: (a, b) => (typeof a === "object" && typeof b === "object" ? a?.id === b?.id && a?.widget === b?.widget : a === b),
        Message: (...a) => ({ msg: a }),
        Wait: () => Promise.resolve(),
        FindUIWidgetWithName: (n) => ({ widget: n }),
        GetUIRoot: () => ({ widget: "__root" }),
        GetUIWidgetName: (w) => w.widget,
        CountOf: () => 0,
        IsPlayerValid: () => true,
        IsType: (o, t) => o !== null && typeof o === "object" && o.kind === "player" && t === "Types.Player",
    };
    const fnProxy = (name) => {
        const f = (...args) => {
            calls.push({ phase, name, args });
            return special[name] ? special[name](...args) : undefined;
        };
        // Enum access (mod.UIAnchor.TopLeft) yields a readable token.
        return new Proxy(f, { get: (_t, p) => (typeof p === "string" ? name + "." + p : undefined) });
    };
    const prevMod = globalThis.mod;
    const prevConsole = globalThis.console;
    const realNow = Date.now;
    let virtualNow = realNow();
    Date.now = () => virtualNow;
    globalThis.mod = new Proxy({}, { get: (_t, p) => fnProxy(String(p)) });
    globalThis.console = {
        ...prevConsole,
        log: (s) => {
            logs.push(String(s));
            calls.push({ phase, name: "LOG", args: [String(s)] });
        },
    };

    let M;
    try {
        M = await import(pathToFileURL(file).href);
    } catch (e) {
        globalThis.mod = prevMod;
        globalThis.console = prevConsole;
        Date.now = realNow;
        throw e;
    }

    const player = { id: 0, kind: "player" };
    const byText = reverseStrings();

    const session = {
        calls,
        logs,
        player,
        setPhase(p) {
            phase = p;
        },
        /** Runs n engine ticks, each taking real time so utils timers expire. */
        async ticks(n = 60) {
            for (let i = 0; i < n; i++) {
                M.OnTickStart?.();
                M.OngoingGlobal?.();
                virtualNow += TICK_MS;
                await new Promise((r) => setTimeout(r, 0));
                M.OnTickEnd?.();
                await new Promise((r) => setTimeout(r, 0));
            }
        },
        start() {
            M.OnGameModeStarted();
        },
        deploy() {
            M.OnPlayerDeployed(player);
        },
        aim() {
            M.OnPortalGadgetAimStart(player);
        },
        /** Clicks the text button whose label is `text` (the strings.json value). */
        click(text) {
            const keys = byText[text];
            if (keys === undefined) throw new Error(`no strings.json entry reads ${JSON.stringify(text)}`);
            const buttons = new Set(calls.filter((c) => c.name === "AddUIButton").map((c) => c.args[0]));
            const label = [...calls]
                .reverse()
                .find((c) => c.name === "AddUIText" && keys.includes(c.args[10]?.msg?.[0]) && buttons.has(c.args[4]?.widget + "_b"));
            if (label === undefined) throw new Error(`no widget is labelled ${JSON.stringify(text)}`);
            const container = label.args[4].widget;
            M.OnPlayerUIButtonEvent(player, { widget: container + "_b" }, "UIButtonEvent.ButtonUp");
        },
        /**
         * Clicks the scene button with this id: finds the visible text-button
         * container at that node's scene position (top-level nodes only, which are
         * placed in absolute coordinates under the root).
         */
        clickId(id) {
            const scene = JSON.parse(readFileSync(resolve(ROOT, "src", "scene.json"), "utf8"));
            const node = scene.screen.find((n) => n.id === id);
            if (node === undefined) throw new Error(`scene.json has no node "${id}"`);
            const want = `${node.x},${node.y},0`;
            const live = {};
            for (const c of calls) {
                if (c.name === "AddUIContainer") live[c.args[0]] = { pos: c.args[1].v.join(","), vis: c.args[5] };
                const w = c.args[0]?.widget;
                if (w === undefined || live[w] === undefined) continue;
                if (c.name === "SetUIWidgetVisible") live[w].vis = c.args[1];
                if (c.name === "SetUIWidgetPosition") live[w].pos = c.args[1].v.join(",");
            }
            const buttons = new Set(calls.filter((c) => c.name === "AddUIButton").map((c) => c.args[0]));
            const hit = Object.entries(live).find(([name, s]) => s.vis && s.pos === want && buttons.has(name + "_b"));
            if (hit === undefined) throw new Error(`no visible button at ${want} for "${id}"`);
            M.OnPlayerUIButtonEvent(player, { widget: hit[0] + "_b" }, "UIButtonEvent.ButtonUp");
        },
        /**
         * The strings.json key the scene text node with this id shows now. Like
         * clickId, it matches the node's scene position (top-level nodes only),
         * and it throws unless exactly one visible text widget is there.
         */
        textId(id) {
            return session.messageId(id)[0];
        },
        /** Like textId, but the whole Message: [key, ...args]. */
        messageId(id) {
            const scene = JSON.parse(readFileSync(resolve(ROOT, "src", "scene.json"), "utf8"));
            const node = scene.screen.find((n) => n.id === id);
            if (node === undefined) throw new Error(`scene.json has no node "${id}"`);
            const want = `${node.x},${node.y},0`;
            // finalState rows: name|kind|parent|pos|size|vis|label (label is JSON, last).
            const hits = finalState(calls)
                .map((row) => row.split("|"))
                .filter((f) => f[1] === "AddUIText" && f[3] === want && f[5] === "true");
            if (hits.length !== 1) throw new Error(`${hits.length} visible text widgets at ${want} for "${id}", expected 1`);
            return JSON.parse(hits[0].slice(6).join("|")).msg;
        },
        dispose() {
            globalThis.mod = prevMod;
            globalThis.console = prevConsole;
            Date.now = realNow;
            rmSync(dir, { recursive: true, force: true });
        },
    };
    return session;
}

/** Engine widgets created per render pass, in order, for one phase. */
export function createdPerPass(calls, phase) {
    const out = [];
    let n = 0;
    for (const c of calls) {
        if (c.phase !== phase) continue;
        if (/^AddUI/.test(c.name)) n++;
        if (c.name === "LOG" && /render end/.test(c.args[0])) {
            out.push(n);
            n = 0;
        }
    }
    if (n > 0) out.push(n);
    return out;
}

/** Final state of every widget: kind, parent, position, size, visibility, label. */
export function finalState(calls) {
    const st = {};
    for (const c of calls) {
        if (/^AddUI/.test(c.name)) {
            st[c.args[0]] = {
                kind: c.name,
                parent: c.args[4]?.widget,
                pos: c.args[1].v.join(","),
                size: c.args[2].v.join(","),
                vis: c.args[5],
                label: c.name === "AddUIText" ? JSON.stringify(c.args[10]) : "",
            };
            continue;
        }
        const w = c.args[0]?.widget;
        if (w === undefined || st[w] === undefined) continue;
        if (c.name === "SetUIWidgetVisible") st[w].vis = c.args[1];
        else if (c.name === "SetUITextLabel") st[w].label = JSON.stringify(c.args[1]);
        else if (c.name === "SetUIWidgetPosition") st[w].pos = c.args[1].v.join(",");
        else if (c.name === "SetUIWidgetSize") st[w].size = c.args[1].v.join(",");
    }
    return Object.entries(st)
        .map(([name, s]) => [name, s.kind, s.parent, s.pos, s.size, s.vis, s.label].join("|"))
        .sort();
}
