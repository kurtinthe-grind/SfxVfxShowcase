// Invariant checks for the bugs that only showed up in game.
//
// A. UI input mode must follow the menu, and it must be the utils' job now.
//
//    The original bug: mod.EnableUIInputMode was enabled in ensure(), which runs on
//    every deploy, and never disabled. Portal swallowed the mouse and the player
//    could not do anything from boot.
//
//    What replaced it: the root UIContainer carries uiInputModeWhenVisible: true, so
//    bf6-portal-utils reference-counts input mode against the root's visibility.
//    bf6-portal-utils/ui/README.md is explicit that mixing a manual
//    mod.EnableUIInputMode with that is unsupported -- the engine has no way to
//    query the current state, so a manual call on top of the automatic one
//    deadlocks the count. So the invariant inverted: the call must be ABSENT, and
//    the root must be the thing that owns it.
//
// B. mod.Message-carrying field values must never be stringified. String() on an
//    opaque Message yields "[object Object]", which msgFor() cannot resolve, so
//    every dynamic label silently fell back to the placeholder.
//
// C. The click router must be gone. ui.ts hands each button an onClickUp closure
//    and setActionHandler() delivers it, so a second subscription to
//    OnPlayerUIButtonEvent would either double-fire or fight the utils' own router.
//
// Both are source-level assertions. That is a real limitation and worth being
// honest about: none of them can be proven without the game, because the browser
// preview has no mod.Message layer and no Portal UI at all. What they do buy is
// that reintroducing a String() on a field, or a manual input-mode call, fails the
// build rather than waiting for the next playtest.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const idx = readFileSync(resolve(ROOT, "src", "index.ts"), "utf8").replace(/\r\n/g, "\n");
const ui = readFileSync(resolve(ROOT, "src", "ui.ts"), "utf8").replace(/\r\n/g, "\n");
const diag = readFileSync(resolve(ROOT, "src", "diag.ts"), "utf8").replace(/\r\n/g, "\n");
const problems = [];

// ---- A. input mode is the utils' job, tied to the root's visibility
const directEnable = [idx, ui].filter((s) => /mod\.EnableUIInputMode\s*\(/.test(s));
if (directEnable.length > 0) {
    problems.push(
        "mod.EnableUIInputMode is called directly; the root container's uiInputModeWhenVisible owns it " +
            "and the utils reference-count it. Mixing the two deadlocks the count (ui/README.md)"
    );
}
if (!/uiInputModeWhenVisible:\s*true/.test(ui)) {
    problems.push("ui.ts never sets uiInputModeWhenVisible: true, so the root will not take the cursor on open");
}
if (!/function setOpen\(/.test(idx)) {
    problems.push("index.ts has no setOpen() helper, so the open state can drift away from what is rendered");
}
if (!/ui\.open = open;/.test(idx)) {
    problems.push("setOpen() no longer assigns ui.open");
}
// Nothing may write ui.open outside setOpen().
const setOpenAt = idx.indexOf("function setOpen(");
const handleAt = idx.indexOf("function handle(");
if (setOpenAt < 0 || handleAt < 0 || handleAt < setOpenAt) {
    problems.push("index.ts lost setOpen() or handle(); cannot check ui.open ownership");
} else {
    const outside = idx.slice(0, setOpenAt) + idx.slice(handleAt);
    for (const line of outside.split("\n")) {
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//")) continue;
        if (/\bui\.open\s*=[^=]/.test(t)) problems.push(`index.ts assigns ui.open outside setOpen(): ${t}`);
    }
    if (!/ui\.open = open;/.test(idx.slice(setOpenAt, handleAt))) {
        problems.push("setOpen() no longer assigns ui.open");
    }
}

// ---- B. Messages survive field resolution
if (/return v === undefined \? body : String\(v\);/.test(ui)) {
    problems.push("ui.ts resolveToken() stringifies field values; a mod.Message becomes [object Object]");
}
if (/if \(v !== undefined\) return String\(v\);/.test(ui)) {
    problems.push("ui.ts rawProp() stringifies bound field values; a mod.Message becomes [object Object]");
}

// ---- C. exactly one click path: the closures, not a second event subscription
const routerSubs = [];
for (const f of readdirSync(resolve(ROOT, "src"))) {
    if (!f.endsWith(".ts")) continue;
    const body = readFileSync(resolve(ROOT, "src", f), "utf8").replace(/\r\n/g, "\n");
    if (/OnPlayerUIButtonEvent\s*\.\s*(subscribe|addListener)/.test(body)) routerSubs.push(f);
}
if (routerSubs.length > 0) {
    problems.push(
        `src/ subscribes to OnPlayerUIButtonEvent in ${routerSubs.join(", ")}; bf6-portal-utils/ui owns that ` +
            "event and routes it to the onClickUp closures, so a second subscription double-fires or fights it"
    );
}
if (!/setActionHandler\s*\(/.test(idx)) {
    problems.push("index.ts never calls setActionHandler(), so no click can reach handle()");
}
if (!/onClickUp\s*:/.test(ui)) {
    problems.push("ui.ts builds no onClickUp handler, so no button can report a click");
}

// ---- C2. the keyboard's children are positioned relative to its container
//
// The query readout was placed with absolute scene coordinates while the key rows
// subtract kb.y, so it rendered on top of the third key row and there was nothing to
// see while typing. The scene was right; the arithmetic in ui.ts was not. Every
// vertical offset inside the keyboard builders has to account for the container.
const qbAt = ui.indexOf("function buildQueryBar(");
const kbAt = ui.indexOf("function buildKeyboard(");
if (qbAt < 0 || kbAt < 0) {
    problems.push("ui.ts is missing buildQueryBar() or buildKeyboard()");
} else {
    const qb = ui.slice(qbAt, ui.indexOf("\n}\n", qbAt));
    if (!/kb\.queryY - kb\.y/.test(qb)) {
        problems.push("buildQueryBar() positions the readout with absolute kb.queryY; the readout is a child of the keyboard container and must use kb.queryY - kb.y");
    }
    const kb = ui.slice(kbAt, ui.indexOf("\n}\n", kbAt));
    // The key rows are the reference implementation: they have always subtracted it.
    if (!/kb\.rowY\[r\] - kb\.y/.test(kb)) {
        problems.push("buildKeyboard() no longer offsets the key rows by kb.y; the keyboard's children are container-relative");
    }
}

// ---- C3. aim is the only thing that opens the menu
//
// The unarmed-fire branch used to call setOpen(ui, true) to show an "arm something
// first" hint. That made fire a second opener: both triggers opened the menu, and
// neither read as "spawn" -- pulling the trigger with nothing armed threw the browser
// open when the player expected a sound. The hint is enough on its own.
//
// This is a distinct assertion from the ui.open-ownership check above, because
// calling setOpen() from the fire handler is otherwise perfectly legal: the ownership
// check only sees direct assignments.
const fireAt = idx.indexOf("OnPortalGadgetFireStart.subscribe");
if (fireAt < 0) {
    problems.push("index.ts has no OnPortalGadgetFireStart subscription");
} else {
    const end = idx.indexOf("\n});", fireAt);
    if (end < 0) {
        problems.push("could not delimit the OnPortalGadgetFireStart handler");
    } else {
        const fire = idx.slice(fireAt, end);
        // Only *opening* is forbidden. setOpen(st.ui, false) after a successful spawn
        // is the point -- the menu closes so the player can see the effect.
        if (/setOpen\s*\([^)]*,\s*true\s*\)/.test(fire)) {
            problems.push("the fire handler opens the menu; gadget aim must be the only opener, and an unarmed fire should just show the hint");
        }
    }
}

// ---- C4. the favourites feature
{
    const at = idx.indexOf("function exportFavourites(");
    if (at < 0) {
        problems.push("index.ts has no exportFavourites()");
    } else {
        const end = idx.indexOf("\n}\n", at);
        const body = idx.slice(at, end < 0 ? undefined : end);

        if (/\blog\(/.test(body) && !/logAlways\(/.test(body)) {
            problems.push("exportFavourites() writes through log(), which the debug switch can silence; an export the player can mute is not an export");
        }
        if (!/logAlways\(/.test(body)) {
            problems.push("exportFavourites() never calls logAlways(), so nothing reaches the log at all");
        }
        if (/rowDisplay\(/.test(body)) {
            problems.push("exportFavourites() logs the display name; the requirement is the index-file member name, which is rowRawName()");
        }
        if (!/rowRawName\(/.test(body)) {
            problems.push("exportFavourites() does not use rowRawName(), so it cannot be logging the index-file name");
        }
    }

    // Order is the feature, so the storage has to be ordered.
    if (!/favourites: string\[\];/.test(ui)) {
        problems.push("PlayerUi.favourites is not an ordered array; the shortlist is exported in the order it was built");
    }
    if (/favourites: Set</.test(ui)) {
        problems.push("PlayerUi.favourites is a Set, which makes the export order an accident rather than a contract");
    }

    // The third tab has to be reachable and has to be handled.
    if (!/export type Tab = "sfx" \| "vfx" \| "fav"/.test(ui)) {
        problems.push("Tab does not include the favourites tab");
    }
    if (!/action === "tabFav"/.test(idx)) {
        problems.push("handle() does not handle tabFav; the shortlist would be unreachable");
    }
    if (!/action === "btnDebug"/.test(idx)) {
        problems.push("handle() does not handle btnDebug; the debug switch would be a dead button");
    }
    // The switch has to actually reach the gate.
    if (!/setDebug\(/.test(idx)) {
        problems.push("the debug button never calls setDebug(); it would change nothing");
    }
    if (!/if \(!debug\) return;/.test(diag)) {
        problems.push("diag.log() ignores the debug switch, so toggling it would do nothing");
    }
}

// ---- C5. one list, derived once
{
    if (!/export function visibleList\(/.test(ui)) {
        problems.push("ui.ts has no visibleList(); the renderer and the click handler each derive the list, and they have already disagreed once");
    }
    // The click handler must not rebuild the list itself.
    const at = idx.indexOf('if (action.charAt(0) === "r")');
    if (at < 0) {
        problems.push("index.ts has no row-action branch");
    } else {
        const end = idx.indexOf("\n    }", at);
        const branch = idx.slice(at, end < 0 ? undefined : end);
        if (!/visibleList\(/.test(branch)) {
            problems.push("the row-action branch does not use visibleList(); it rebuilds the list, which addresses the wrong row on the favourites tab");
        }
        if (/listFor\(ui\.tab/.test(branch)) {
            problems.push("the row-action branch calls listFor(ui.tab, ...); on the favourites tab that ignores the shortlist entirely");
        }
    }
    // And render() must use the same one.
    const rn = ui.indexOf("export function render(");
    if (rn < 0) {
        problems.push("ui.ts has no render()");
    } else {
        const end = ui.indexOf("\n}\n", rn);
        const body = ui.slice(rn, end < 0 ? undefined : end);
        if (!/visibleList\(/.test(body)) {
            problems.push("render() does not use visibleList()");
        }
    }
}

// ---- D. the nested-group cascade
if (!/groupVisible\[n\.parent\] === false/.test(ui)) {
    problems.push("ui.ts buildNodes() does not cascade group visibility; nested groups leak when the menu is closed");
}

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
    for (const [k, v] of Object.entries(o)) walk(v, where === "" ? k : where);
})(sceneJson, "");
for (const m of ui.matchAll(/\{\s*k:\s*"textbutton"[^}]*\}/g)) {
    if (!/fill:\s*"Solid"/.test(m[0])) unfilled.push("ui.ts:" + m[0].slice(0, 60));
}
if (unfilled.length > 0) {
    problems.push(`buttons without fill "Solid" (no visible controller highlight): ${unfilled.join(", ")}`);
}

if (problems.length > 0) {
    console.error("  INVARIANT BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}
console.log(
    "  invariants: input mode owned by the root's uiInputModeWhenVisible (0 manual calls), " +
        "one click path (closures + setActionHandler, 0 event subscriptions), " +
        "field Messages not stringified, group visibility cascades, every button solid-filled"
);
