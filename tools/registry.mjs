// QR asset-ID registry: assignment and validation. Pure functions; tools/gen-ids.mjs
// does the file I/O and tools/test-qr-mapping.mjs tests these directly.
//
// A registry (registry/mapping-<n>.json) is append-only:
//   - an entry's id, kind and name never change once written;
//   - an asset that leaves the catalog is marked "retired", never deleted, and its
//     ID is never given to anything else;
//   - new assets get the next unused IDs, in catalog order.
// So a code made by any older build decodes to the same names forever.

import { ALPHABET, ID_RE, ID_WIDTH, idOf, numOf } from "../site/js/codec.js";

export const KINDS = ["sfx", "vfx", "screen", "music-event", "music-param"];
export const STATUSES = ["active", "retired"];

const keyOf = (e) => e.kind + ":" + e.name;

export function emptyRegistry(mapping) {
    return { mapping, alphabet: ALPHABET, width: ID_WIDTH, next: 0, assets: [] };
}

/** Every problem with a registry, as strings. Empty means valid. */
export function validateRegistry(reg) {
    const bad = [];
    if (!Number.isInteger(reg.mapping) || reg.mapping < 1) bad.push(`mapping must be a positive integer, got ${JSON.stringify(reg.mapping)}`);
    if (reg.alphabet !== ALPHABET) bad.push(`alphabet must be ${ALPHABET}`);
    if (reg.width !== ID_WIDTH) bad.push(`width must be ${ID_WIDTH}`);
    if (!Number.isInteger(reg.next) || reg.next < 0) bad.push(`next must be a non-negative integer`);
    if (!Array.isArray(reg.assets)) return [...bad, "assets must be an array"];
    const ids = new Map();
    const keys = new Map();
    for (const e of reg.assets) {
        const where = JSON.stringify(e);
        if (typeof e.id !== "string" || !ID_RE.test(e.id)) bad.push(`invalid ID in ${where}`);
        else if (numOf(e.id) >= reg.next) bad.push(`ID ${e.id} is not below next (${idOf(Math.min(reg.next, 32767))}): ${where}`);
        if (!KINDS.includes(e.kind)) bad.push(`unknown kind in ${where}`);
        if (typeof e.name !== "string" || e.name === "") bad.push(`missing name in ${where}`);
        if (!STATUSES.includes(e.status)) bad.push(`unknown status in ${where}`);
        if (ids.has(e.id)) bad.push(`ID ${e.id} is used twice: ${ids.get(e.id)} and ${keyOf(e)}`);
        else ids.set(e.id, keyOf(e));
        if (keys.has(keyOf(e))) bad.push(`${keyOf(e)} has two IDs: ${keys.get(keyOf(e))} and ${e.id}`);
        else keys.set(keyOf(e), e.id);
    }
    return bad;
}

/**
 * Problems introduced between a published registry and a new one: a changed or
 * removed entry, or `next` going backwards (which would let an ID be reused).
 */
export function compareRegistries(before, after) {
    const bad = [];
    if (before.mapping !== after.mapping) bad.push(`mapping changed from ${before.mapping} to ${after.mapping}`);
    if (after.next < before.next) bad.push(`next went back from ${before.next} to ${after.next}: IDs would be reused`);
    const now = new Map(after.assets.map((e) => [e.id, e]));
    for (const e of before.assets) {
        const n = now.get(e.id);
        if (n === undefined) bad.push(`ID ${e.id} (${keyOf(e)}) was deleted; retire it instead`);
        else if (n.kind !== e.kind || n.name !== e.name) bad.push(`ID ${e.id} changed meaning: ${keyOf(e)} -> ${keyOf(n)}`);
    }
    for (const e of after.assets) {
        const n = numOf(e.id);
        if (n < before.next && !before.assets.some((b) => b.id === e.id)) bad.push(`ID ${e.id} (${keyOf(e)}) reuses a reserved ID below ${before.next}`);
    }
    return bad;
}

/**
 * Brings a registry up to date with the current catalog. `current` is
 * [{kind, name}] in canonical order. Returns a new registry and what changed.
 */
export function assignIds(reg, current) {
    const out = { ...reg, assets: reg.assets.map((e) => ({ ...e })) };
    const live = new Set(current.map(keyOf));
    const known = new Map(out.assets.map((e) => [keyOf(e), e]));
    const added = [];
    const retired = [];
    const revived = [];
    for (const e of out.assets) {
        const status = live.has(keyOf(e)) ? "active" : "retired";
        if (status !== e.status) (status === "retired" ? retired : revived).push(e);
        e.status = status;
    }
    for (const c of current) {
        if (known.has(keyOf(c))) continue;
        const e = { id: idOf(out.next), kind: c.kind, name: c.name, status: "active" };
        out.next++;
        out.assets.push(e);
        known.set(keyOf(e), e);
        added.push(e);
    }
    return { registry: out, added, retired, revived };
}

/** ID number of each name, in the given order. */
export function idNumbers(reg, kind, names) {
    const byKey = new Map(reg.assets.map((e) => [keyOf(e), e]));
    return names.map((name) => {
        const e = byKey.get(kind + ":" + name);
        if (e === undefined) throw new Error(`${kind}:${name} has no ID`);
        return numOf(e.id);
    });
}

/** [first index, its ID, ...]: a new run starts wherever IDs stop counting up by one. */
export function idRuns(nums) {
    const runs = [];
    for (let i = 0; i < nums.length; i++) if (i === 0 || nums[i] !== nums[i - 1] + 1) runs.push(i, nums[i]);
    return runs;
}

/** Inverse of idRuns, as the mod computes it. */
export function runLookup(runs, index) {
    let at = 0;
    for (let i = 0; i < runs.length; i += 2) if (runs[i] <= index) at = i;
    return runs[at + 1] + (index - runs[at]);
}

/** Registry as written to disk: one entry per line so diffs show exactly what was added. */
export function formatRegistry(reg) {
    const head = { $comment: reg.$comment, mapping: reg.mapping, alphabet: reg.alphabet, width: reg.width, next: reg.next };
    const lines = Object.entries(head)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    const rows = reg.assets.map((e) => `        { "id": ${JSON.stringify(e.id)}, "kind": ${JSON.stringify(e.kind)}, "name": ${JSON.stringify(e.name)}, "status": ${JSON.stringify(e.status)} }`);
    return "{\n" + lines.join("\n") + '\n    "assets": [\n' + rows.join(",\n") + "\n    ]\n}\n";
}

/**
 * The website's lookup table for one mapping. `details` maps "kind:name" to
 * display extras from the current sources: g (group), l (label), a (1 = volume param).
 */
export function siteMap(reg, details, radio) {
    const ids = {};
    for (const e of reg.assets) {
        const d = details.get(keyOf(e)) ?? {};
        const o = { k: e.kind, n: e.name };
        if (d.g !== undefined) o.g = d.g;
        if (d.l !== undefined) o.l = d.l;
        if (d.a !== undefined) o.a = d.a;
        if (e.status === "retired") o.s = "retired";
        ids[e.id] = o;
    }
    return { mapping: reg.mapping, alphabet: reg.alphabet, width: reg.width, next: reg.next, count: reg.assets.length, radio, ids };
}
