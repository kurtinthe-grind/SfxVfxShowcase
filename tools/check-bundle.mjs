// Post-build assertions on dist/bundle.ts, repointed at the bf6-portal-utils
// architecture.
//
// What changed and why:
//
//   A. Input mode. The old gate required an EnableUIInputMode call to EXIST and to
//      be non-constant. That is now the bug, not the fix: the root UIContainer
//      carries uiInputModeWhenVisible: true and the utils reference-count
//      EnableUIInputMode against the root's visibility. A manual call in the mod
//      deadlocks that count (ui/README.md: "the engine provides no way to query
//      input mode state"). So the bundle must contain the utils' call and must not
//      contain one of ours -- and it will contain the utils' one, because the
//      package is inlined. The distinction is the receiver: the utils pass their
//      own internal receiver scope, ours would pass a mod.Player.
//
//   B. The labelled button. UIContainer + button + text + BUTTON_SUFFIX is gone.
//      UITextButton carries its own label and handler, so there is no name suffix
//      to parse and no create-order rule to satisfy. What replaces it: the bundle
//      must build UITextButton with a label and an onClickUp, and must not contain
//      the removed widget calls at all.
//
//   C. The click router. "ui event: widget=" came from logging every raw
//      OnPlayerUIButtonEvent before name filtering. The utils own that event now,
//      and the mod must not subscribe, so that log line is expected to be GONE.
//      Its replacement is the UNHANDLED ACTION line, which is what catches a
//      misrouted click now.
import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const DIST = resolve(ROOT, "dist");
const bundle = readFileSync(resolve(DIST, "bundle.ts"), "utf8");
const strings = JSON.parse(readFileSync(resolve(DIST, "bundle.strings.json"), "utf8"));
const problems = [];

const require = (cond, label) => {
    if (!cond) problems.push(label);
};

// ---- A. input mode belongs to the utils, keyed off the root's visibility
require(bundle.includes("uiInputModeWhenVisible"), "bundle has no uiInputModeWhenVisible, so the root will not take the cursor");

// The package calls mod.EnableUIInputMode with a literal on purpose -- that is what
// adding and removing a requester means. So the assertion is ownership, not the
// argument: the package's calls pass its own internal receiver or none at all, and
// a call of ours would pass the only receiver this mod holds.
const enableCalls = [...bundle.matchAll(/mod\.EnableUIInputMode\(([^)]*)\)/g)];
require(enableCalls.length > 0, "bundle has no EnableUIInputMode at all, so the utils never take the cursor");
for (const m of enableCalls) {
    require(
        /^\s*(true|false)?\s*(,\s*this\._nativeReceiver\s*)?$/.test(m[1]),
        `bundle has a mod.EnableUIInputMode(${m[1]}) that the package does not own; a receiver here is a player handle and deadlocks the reference count`
    );
}

// The package's single routing subscription is what makes onClickUp work, so it
// must be present -- and it must be the only one.
const clickSubs = [...bundle.matchAll(/Events\.OnPlayerUIButtonEvent\.subscribe/g)];
require(clickSubs.length === 1, `bundle has ${clickSubs.length} OnPlayerUIButtonEvent subscriptions; the utils contribute exactly one, so the mod added its own`);

// ---- B. field Messages must survive resolution
require(
    !bundle.includes("body : String(v)"),
    "bundle still stringifies a resolved field; a mod.Message becomes [object Object]"
);
require(
    !bundle.includes("undefined) return String(v);"),
    "bundle still stringifies a bound field; a mod.Message becomes [object Object]"
);

// ---- C. nested group visibility must cascade
require(
    bundle.includes("groupVisible[n.parent] === false"),
    "bundle lost the group visibility cascade; nested groups leak when the menu is closed"
);

// ---- diagnostics present
require(bundle.includes("console.log"), "bundle has no console.log sink");
require(bundle.includes("MISSING TEXT KEY"), "bundle does not report missing text keys");
require(
    bundle.includes("UNHANDLED ACTION"),
    "bundle does not report an action handle() did not claim; a misrouted click would be silent again"
);
// The utils' own logger must be wired, or a rejection inside the package is invisible.
require(bundle.includes("setLogging"), "bundle never wires a logger into the UI module");
require(
    !bundle.includes("ui event: widget="),
    "bundle still logs raw UI button events; that router is gone, so this is a stale name-parsing path"
);

// ---- D. a labelled button is one UITextButton with a label and a handler
const tbAt = bundle.indexOf("new UITextButton(");
require(tbAt >= 0, "bundle builds no UITextButton, so no labelled clickable element exists");
if (tbAt >= 0) {
    const tb = bundle.slice(tbAt, tbAt + 1200);
    require(/label:/.test(tb), "the bundled UITextButton has no label, so it renders blank");
    require(/onClickUp\s*:/.test(tb), "the bundled UITextButton has no onClickUp, so it cannot report a click");
}
for (const legacy of ["AddUIContainer(nm,", 'AddUIButton(nm + "_b"', 'AddUIText(nm + "_t"']) {
    require(!bundle.includes(legacy), `bundle still contains ${legacy} from the removed hand-rolled widget layer`);
}
require(!bundle.includes("BUTTON_SUFFIX"), "bundle still carries BUTTON_SUFFIX; the click router is gone");
require(bundle.includes("setActionHandler"), "bundle never calls setActionHandler, so no click can reach handle()");

// ---- E. the row's PLAY and SELECT labels are strings keys, not raw config reads
//
// The row used to carry a bare one-letter glyph. It is a labelled PLAY button now,
// so the assertion follows the label rather than the glyph. The glyph strings are
// still generated (check-strings keeps config.ts and gen-text.mjs in agreement on
// them) but nothing reads them, and nothing may read them as raw config either.
require(bundle.includes("K(T.play)"), "the row's PLAY label is not routed through a strings key");
require(!bundle.includes("CONFIG.playGlyph"), "bundle still reads the glyph as a raw config string");

// No field resolver may stringify a value: String() on an opaque Message gives
// "[object Object]", which is what put the placeholder in the chips and SEARCH.
const rawPropBody = bundle.slice(bundle.indexOf("function rawProp("), bundle.indexOf("function rawProp(") + 1200);
require(!rawPropBody.includes("String(raw)"), "bundle still stringifies an inline spec value");

// ---- control scheme
require(bundle.includes("open: false"), "the menu does not start closed");
require(bundle.includes("OnPortalGadgetAimStart"), "gadget aim does not open the menu");

// ---- catalog integrity
const a = bundle.indexOf("export const SFX_CATALOG");
const b = bundle.indexOf("export const VFX_CATALOG");
const sfxBlock = bundle.slice(a, b);
const sfx = sfxBlock.match(/\n {4}\{ name: /g)?.length ?? 0;
const vfx = bundle.slice(b).match(/\n {4}\{ name: /g)?.length ?? 0;
require(sfx === 936, `expected 936 sfx, found ${sfx}`);
require(vfx === 312, `expected 312 vfx, found ${vfx}`);
require(
    !/Brooklyn_Spots_EmergencyExit|Brooklyn_Shared_Spots_Water_Splash_Head/.test(sfxBlock),
    "a banned asset reached the shipped catalog"
);

if (problems.length > 0) {
    console.error("  BUNDLE BUGS:");
    for (const p of problems) console.error("    - " + p);
    process.exit(1);
}

console.log(
    `  bundle  : ${statSync(resolve(DIST, "bundle.ts")).size} bytes, ${Object.keys(strings).length} strings, ` +
        `${sfx} sfx / ${vfx} vfx, 0 banned, input mode owned by the root, one click path, Message passthrough intact`
);
