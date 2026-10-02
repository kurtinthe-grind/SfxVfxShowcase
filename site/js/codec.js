// SFX/VFX Showcase QR codec: compact payloads <-> asset names.
// Pure functions, no DOM: the website and the Node tests both import this file.
// src/qrexport.ts is the in-game encoder; tools/test-qr-mapping.mjs checks that the
// two produce identical payloads.
//
// Payload, format 1 (all ASCII, URL-fragment safe):
//
//   SV<format>.<mapping>.<part>-<of>.<list>.<body>.<check>
//
//   format   payload layout version (this file reads 1)
//   mapping  which ID table the IDs belong to (data/map-<mapping>.json)
//   part/of  this code's place in a list split across several codes
//   list     4-char hash of the whole list's body (all parts joined)
//   body     asset IDs, 3 chars each, then "~"-prefixed music/radio templates
//   check    4-char hash of everything before the final "."
//
// The hashes catch damaged or hand-edited payloads. They are not security: the
// mapping is public and the IDs are plain identifiers, not encryption.

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
export const ID_WIDTH = 3;
export const HASH_WIDTH = 4;
export const FORMAT = 1;
export const MAGIC = "SV";
export const QR_BYTES = 718; // byte-mode capacity of the largest code the mod draws (version 18, ECC L)
export const LIMITS = { maxChars: 4096, maxItems: 2000, maxParts: 99 };
const HASH_MOD = 1048573; // largest prime below 32^4

export const ID_RE = /^[0-9A-HJKMNP-TV-Z]{3}$/;

/** Number -> fixed-width base32 text. */
export function idOf(n, width = ID_WIDTH) {
    if (!Number.isInteger(n) || n < 0 || n >= Math.pow(32, width)) throw new RangeError(`id ${n} does not fit ${width} chars`);
    let s = "";
    for (let i = 0; i < width; i++) {
        s = ALPHABET.charAt(n % 32) + s;
        n = Math.floor(n / 32);
    }
    return s;
}

/** Base32 text -> number; -1 when a character is outside the alphabet. */
export function numOf(id) {
    let n = 0;
    for (const ch of id) {
        const d = ALPHABET.indexOf(ch);
        if (d < 0) return -1;
        n = n * 32 + d;
    }
    return n;
}

/** 4-char hash. Same arithmetic as src/qrexport.ts; exact in doubles (h * 31 + 0xFFFF < 2^53). */
export function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % HASH_MOD;
    return idOf(h, HASH_WIDTH);
}

function headerOf(mapping, part, of, list) {
    return MAGIC + FORMAT + "." + mapping + "." + part + "-" + of + "." + list + ".";
}

/** Number as the mod writes it: at most 2 decimals, no exponent. */
export function numText(v) {
    return String(Math.round(v * 100) / 100);
}

/** A template's body code. params: [[id, value], ...]; picks: [[ch, biome, track], ...]. */
export function musicCode(eventId, params) {
    return "~M" + eventId + params.map(([id, v]) => "," + id + numText(v)).join("");
}
export function radioCode(params, picks) {
    return "~R" + params.map(([id, v]) => "," + id + numText(v)).join("") + picks.map((p) => ";" + p.join(".")).join("");
}

/** Cuts a radio template's queue so the code fits `room`; other codes are returned whole. */
function fitCode(code, room) {
    if (code.length <= room) return code;
    let cut = code;
    while (cut.length > room && cut.lastIndexOf(";") > 0) cut = cut.slice(0, cut.lastIndexOf(";"));
    return cut;
}

/**
 * Packs item codes (asset IDs first, then "~" templates) into payloads of at most
 * maxBytes, never splitting an item. `prefix` (the site URL plus "#") is not hashed.
 */
export function packPayloads(codes, { mapping, maxBytes = QR_BYTES, prefix = "" }) {
    if (codes.length === 0) return [];
    const room = maxBytes - prefix.length - headerOf(mapping, 99, 99, "0000").length - 1 - HASH_WIDTH;
    const parts = [];
    let cur = "";
    for (const raw of codes) {
        const code = fitCode(raw, room);
        if (cur !== "" && cur.length + code.length > room) {
            parts.push(cur);
            cur = "";
        }
        cur += code;
    }
    parts.push(cur);
    const list = hash(parts.join(""));
    return parts.map((body, i) => {
        const head = headerOf(mapping, i + 1, parts.length, list) + body;
        return prefix + head + "." + hash(head);
    });
}

// ---------------------------------------------------------------- decoding

const LEGACY_HEAD = /^SFX\/VFX SHOWCASE FAVOURITES (\d+)\/(\d+)$/;
const COMPACT = /^SV(\d+)\./;
const HEADER_1 = /^SV1\.(\d+)\.(\d+)-(\d+)\.([0-9A-Z]{4})\./;

/** The payload inside whatever was scanned or pasted: a site URL, a bare payload, or legacy text. */
export function extractPayload(input) {
    let text = String(input ?? "").replace(/^﻿/, "").trim();
    const hashAt = text.indexOf("#");
    if (/^https?:\/\//i.test(text) && hashAt >= 0) text = text.slice(hashAt + 1);
    else if (text.startsWith("#")) text = text.slice(1);
    if (/%[0-9A-Fa-f]{2}/.test(text)) {
        try {
            text = decodeURIComponent(text);
        } catch {
            // keep the raw text; the parser reports what is wrong with it
        }
    }
    return text.trim();
}

function problem(code, message) {
    return { code, message };
}

/**
 * Splits a body into items without resolving them.
 * Returns { items: [{type:"asset", id, malformed} | {type:"template", ...}], errors }.
 */
export function parseBody(body) {
    const items = [];
    const errors = [];
    const sections = body.split("~");
    const assets = sections[0];
    for (let i = 0; i < assets.length; i += ID_WIDTH) {
        const id = assets.slice(i, i + ID_WIDTH);
        items.push({ type: "asset", id, malformed: !ID_RE.test(id) });
    }
    if (assets.length % ID_WIDTH !== 0) errors.push(problem("malformed-id", `The ID section is ${assets.length} characters, not a multiple of ${ID_WIDTH}: the last ID is cut short.`));
    for (const raw of sections.slice(1)) items.push(parseTemplate(raw));
    return { items, errors };
}

const NUM = /^-?\d+(\.\d+)?$/;

function parseParams(fields) {
    const params = [];
    let bad = false;
    for (const f of fields) {
        const id = f.slice(0, ID_WIDTH);
        const v = f.slice(ID_WIDTH);
        if (!ID_RE.test(id) || !NUM.test(v)) bad = true;
        else params.push({ id, value: Number(v) });
    }
    return { params, bad };
}

function parseTemplate(raw) {
    const t = { type: "template", raw: "~" + raw, kind: raw.charAt(0) === "M" ? "music" : raw.charAt(0) === "R" ? "radio" : "?", malformed: false };
    if (t.kind === "music") {
        const [head, ...fields] = raw.slice(1).split(",");
        t.eventId = head;
        const p = parseParams(fields);
        t.params = p.params;
        t.malformed = p.bad || !ID_RE.test(head);
    } else if (t.kind === "radio") {
        const [paramPart, ...pickParts] = raw.slice(1).split(";");
        const fields = paramPart.split(",");
        if (fields[0] !== "") t.malformed = true;
        const p = parseParams(fields.slice(1));
        t.params = p.params;
        t.picks = [];
        for (const s of pickParts) {
            const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
            if (m === null) t.malformed = true;
            else t.picks.push({ ch: Number(m[1]), biome: Number(m[2]), track: Number(m[3]) });
        }
        t.malformed = t.malformed || p.bad;
    } else t.malformed = true;
    return t;
}

/**
 * Reads the header and body of one compact payload. Never throws.
 * { ok, formatVersion, mapping, part, of, list, check, checkOk, body, errors }
 */
export function parseCompact(text) {
    const out = { ok: false, formatVersion: undefined, mapping: undefined, part: 1, of: 1, list: "", check: "", checkOk: false, body: "", errors: [] };
    const f = COMPACT.exec(text);
    if (f === null) {
        out.errors.push(problem("unsupported-format", "This is not an SFX/VFX Showcase QR payload."));
        return out;
    }
    out.formatVersion = Number(f[1]);
    if (out.formatVersion !== FORMAT) {
        out.errors.push(problem("unsupported-format", `QR format ${out.formatVersion} is not supported by this page (it reads format ${FORMAT}). The code may be from a newer mod: reload the page to get the latest decoder.`));
        return out;
    }
    const h = HEADER_1.exec(text);
    const tail = /\.([0-9A-Z]{4})$/.exec(text);
    if (h === null || tail === null || tail.index < h[0].length - 1) {
        out.errors.push(problem("corrupt", "The payload header or checksum is damaged or missing."));
        return out;
    }
    out.mapping = Number(h[1]);
    out.part = Number(h[2]);
    out.of = Number(h[3]);
    out.list = h[4];
    out.check = tail[1];
    out.body = text.slice(h[0].length, tail.index);
    out.checkOk = hash(text.slice(0, tail.index)) === out.check;
    if (!out.checkOk) out.errors.push(problem("corrupt", `Checksum mismatch: the payload was changed or damaged after it was made (expected ${hash(text.slice(0, tail.index))}, found ${out.check}).`));
    if (out.part < 1 || out.of < 1 || out.part > out.of || out.of > LIMITS.maxParts) out.errors.push(problem("corrupt", `Impossible part number ${out.part} of ${out.of}.`));
    out.ok = out.errors.length === 0;
    return out;
}

/** Name -> entry index for legacy text (asset names, and screen-effect labels). */
function reverseIndex(map) {
    if (map._byName !== undefined) return map._byName;
    const idx = new Map();
    for (const [id, e] of Object.entries(map.ids)) {
        const hit = { id, ...e };
        if (!idx.has(e.n) || e.s !== "retired") idx.set(e.n, hit);
        if (e.l !== undefined && (!idx.has(e.l) || e.s !== "retired")) idx.set(e.l, hit);
    }
    Object.defineProperty(map, "_byName", { value: idx, enumerable: false });
    return idx;
}

function assetItem(id, e) {
    return { type: "asset", id, name: e.l ?? e.n, enumName: e.n, kind: e.k, group: e.g ?? "", status: e.s === "retired" ? "retired" : "ok" };
}

function paramLookup(map, params, issues) {
    return params.map((p) => {
        const e = map.ids[p.id];
        if (e === undefined || e.k !== "music-param") {
            issues.push(`unknown parameter ID ${p.id}`);
            return { id: p.id, name: "?" + p.id, value: p.value, amp: false };
        }
        return { id: p.id, name: e.n, value: p.value, amp: e.a === 1 };
    });
}

function stationText(map, ch, biome) {
    const r = map.radio ?? { channels: [], biomes: [] };
    return (ch === 4 ? r.biomes[biome] : r.channels[ch]) ?? "?";
}

/** One template as the in-game EXPORT line (numbered by position among the list's templates). */
function resolveTemplate(t, map, n) {
    const out = { type: "template", kind: t.kind, raw: t.raw, status: "ok", issues: [], line: "" };
    if (t.malformed) {
        out.status = "malformed";
        out.issues.push("the template code cannot be read");
        out.line = `TEMPLATE ${n} | malformed: ${t.raw}`;
        return out;
    }
    const params = paramLookup(map, t.params, out.issues);
    const amp = params.find((p) => p.amp);
    const rest = params.filter((p) => !p.amp);
    if (t.kind === "music") {
        const e = map.ids[t.eventId];
        if (e === undefined || e.k !== "music-event") out.issues.push(`unknown music event ID ${t.eventId}`);
        out.package = e?.g ?? "?";
        out.event = e?.n ?? "?" + t.eventId;
        out.params = rest.map((p) => ({ name: p.name, value: p.value }));
        out.volume = amp?.value;
        const ps = rest.map((p) => p.name + " " + p.value).join(", ");
        out.line = `MUSIC TEMPLATE ${n} | ${out.package} | ${out.event} | ${ps === "" ? "no params" : ps} | volume ${amp?.value ?? "?"}`;
    } else {
        const v = (name) => params.find((p) => p.name === name)?.value;
        const ch = Math.round(v("Radio_Channel") ?? 0);
        const biome = Math.round(v("Radio_Biome") ?? 0);
        const own = (p) => p.ch === ch && (ch !== 4 || p.biome === biome);
        const mixed = t.picks.some((p) => !own(p));
        out.package = "Radio";
        out.queue = t.picks;
        out.params = rest.map((p) => ({ name: p.name, value: p.value }));
        out.volume = amp?.value;
        const queue = t.picks.length === 0 ? "queue empty" : "queue " + t.picks.map((p) => (mixed ? stationText(map, p.ch, p.biome) + " " : "") + "#" + p.track).join(", ");
        out.line = `RADIO TEMPLATE ${n} | channel ${ch} ${stationText(map, ch, biome)} | ${queue} | continue ${v("Radio_ContinueQueueOnTrackEnd")}, loop ${v("Radio_LoopQueuedTracks")} | volume ${v("Radio_Amplitude")}`;
    }
    if (out.issues.length > 0) out.status = "unknown";
    return out;
}

/** Resolves parsed body items against a map. */
export function resolveItems(parsed, map) {
    const seen = new Map();
    const span = map.next !== undefined ? ` (this page knows IDs ${idOf(0)} to ${idOf(map.next - 1)})` : "";
    let tn = 0;
    return parsed.map((it) => {
        if (it.type === "template") return resolveTemplate(it, map, ++tn);
        if (it.malformed) return { type: "asset", id: it.id, name: "", status: "malformed", note: `"${it.id}" is not a valid ${ID_WIDTH}-character ID (allowed: ${ALPHABET}).` };
        const e = map.ids[it.id];
        const count = (seen.get(it.id) ?? 0) + 1;
        seen.set(it.id, count);
        const base = e === undefined || e.k === "music-event" || e.k === "music-param"
            ? { type: "asset", id: it.id, name: "", status: "unknown", note: `Unknown asset ID ${it.id}: not an asset in mapping ${map.mapping}${span}. The code may come from a newer mod build than this page, or it was altered.` }
            : assetItem(it.id, e);
        if (base.status === "retired") base.note = `${base.name} was removed from the mod's catalog; its ID stays reserved so old codes still decode.`;
        if (count > 1) base.repeat = count;
        return base;
    });
}

function statsOf(items) {
    const assets = items.filter((i) => i.type === "asset");
    return {
        assets: assets.length,
        known: assets.filter((i) => i.status === "ok" || i.status === "retired").length,
        unknown: assets.filter((i) => i.status === "unknown").length,
        malformed: assets.filter((i) => i.status === "malformed").length + items.filter((i) => i.type === "template" && i.status === "malformed").length,
        retired: assets.filter((i) => i.status === "retired").length,
        repeated: assets.filter((i) => i.repeat !== undefined).length,
        templates: items.filter((i) => i.type === "template").length,
    };
}

/** Legacy plain-text codes and pasted EXPORT logs: one name (or template line) per line. */
function decodeLegacy(text, map) {
    const lines = text.split(/\r?\n/).map((l) => l.replace(/^<SfxVfxShowcase>\s*/, "").trim()).filter((l) => l !== "");
    const out = { kind: "legacy", part: 1, of: 1, marked: false, errors: [], warnings: [] };
    const head = LEGACY_HEAD.exec(lines[0] ?? "");
    out.marked = head !== null || lines.some((l) => /^-{4} (END )?FAVOURITES/.test(l));
    if (head !== null) {
        out.part = Number(head[1]);
        out.of = Number(head[2]);
        lines.shift();
    }
    const idx = map !== undefined ? reverseIndex(map) : new Map();
    const items = [];
    const seen = new Map();
    for (const l of lines) {
        if (/^-{4} (END )?FAVOURITES/.test(l)) continue;
        if (/^(MUSIC|RADIO) TEMPLATE \d+ \| /.test(l)) {
            items.push({ type: "template", kind: l.startsWith("MUSIC") ? "music" : "radio", status: "ok", line: l, issues: [] });
            continue;
        }
        const name = l.split(" | ")[0].trim();
        const e = idx.get(name);
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        const it = e !== undefined ? assetItem(e.id, e) : { type: "asset", id: "", name, status: "unknown", note: `"${name}" is not in mapping ${map?.mapping ?? "?"}. It is shown as written.` };
        if (e !== undefined && e.s === "retired") it.note = `${it.name} was removed from the mod's catalog.`;
        if (count > 1) it.repeat = count;
        items.push(it);
    }
    out.items = items;
    out.warnings.push(problem("legacy", "Legacy code: it holds full asset names (made by an older mod build). Shown with the IDs the current mapping gives them."));
    if (map !== undefined) out.mapping = map.mapping;
    return out;
}

/**
 * Decodes scanned or pasted text. `maps` is { [mappingId]: mapJson } and
 * `current` the mapping assumed for bare ID lists. Never throws.
 *
 * Result: { kind: "compact"|"legacy"|"bare"|"other"|"empty", status: "ok"|"warning"|"error",
 *           formatVersion, mapping, part, of, list, checkOk, body, items, stats, errors, warnings }
 */
export function decode(input, maps, current) {
    const text = extractPayload(input);
    const result = { kind: "empty", status: "error", formatVersion: undefined, mapping: undefined, part: 1, of: 1, list: "", checkOk: false, body: "", payload: text, items: [], errors: [], warnings: [] };
    const finish = () => {
        result.stats = statsOf(result.items);
        if (result.stats.unknown > 0) result.warnings.push(problem("unknown-id", `${result.stats.unknown} ID(s) are not in the mapping.`));
        if (result.stats.malformed > 0) result.warnings.push(problem("malformed-id", `${result.stats.malformed} item(s) are malformed.`));
        result.status = result.errors.length > 0 ? "error" : result.warnings.length > 0 ? "warning" : "ok";
        return result;
    };
    if (text === "") {
        result.errors.push(problem("empty", "Nothing to decode."));
        return finish();
    }
    if (text.length > LIMITS.maxChars) {
        result.errors.push(problem("too-large", `The payload is ${text.length} characters; a QR code holds at most ${LIMITS.maxChars}.`));
        return finish();
    }
    if (COMPACT.test(text)) {
        result.kind = "compact";
        const p = parseCompact(text);
        Object.assign(result, { formatVersion: p.formatVersion, mapping: p.mapping, part: p.part, of: p.of, list: p.list, checkOk: p.checkOk, body: p.body });
        result.errors.push(...p.errors);
        if (p.formatVersion !== FORMAT || p.mapping === undefined) return finish();
        const map = maps[p.mapping];
        if (map === undefined) {
            result.errors.push(problem("unsupported-mapping", `Mapping ${p.mapping} is not published on this page (known: ${Object.keys(maps).join(", ") || "none"}). The code may come from a newer mod: reload the page.`));
            return finish();
        }
        const body = parseBody(p.body);
        if (body.items.length > LIMITS.maxItems) {
            result.errors.push(problem("too-large", `The payload lists ${body.items.length} items; the limit is ${LIMITS.maxItems}.`));
            return finish();
        }
        result.errors.push(...body.errors);
        result.items = resolveItems(body.items, map);
        return finish();
    }
    // Bare IDs, e.g. typed by hand: "0A1,0B2" or "0a1 0b2". Anything else is read as names.
    const bare = text.replace(/[\s,]+/g, "").toUpperCase();
    if (/^[^\n]*$/.test(text) && bare.length % ID_WIDTH === 0 && [...bare].every((c) => ALPHABET.includes(c))) {
        result.kind = "bare";
        const map = maps[current];
        result.mapping = current;
        result.body = bare;
        result.warnings.push(problem("no-header", `No header: read as bare IDs in mapping ${current}, with no checksum.`));
        if (map === undefined) {
            result.errors.push(problem("unsupported-mapping", `Mapping ${current} is not loaded.`));
            return finish();
        }
        const body = parseBody(result.body);
        result.errors.push(...body.errors);
        result.items = resolveItems(body.items, map);
        return finish();
    }
    const notOurs = () => {
        result.kind = "other";
        result.errors.push(problem("unsupported-format", "This is not an SFX/VFX Showcase code: no payload, legacy header or known asset name found."));
        return finish();
    };
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return notOurs();
    const legacy = decodeLegacy(text, maps[current]);
    // Only treat text as a legacy list if something in it is ours.
    if (!legacy.marked && !legacy.items.some((i) => i.type === "template" || i.status !== "unknown")) return notOurs();
    Object.assign(result, { kind: "legacy", part: legacy.part, of: legacy.of, mapping: legacy.mapping, items: legacy.items });
    result.warnings.push(...legacy.warnings);
    return finish();
}

/**
 * Joins the parts of one list (results of decode with the same list hash).
 * Returns { complete, missing, items, listOk }.
 */
export function combineParts(parts) {
    if (parts.length === 0) return { complete: false, missing: [], items: [], listOk: false };
    const of = parts[0].of;
    const byPart = new Map();
    for (const r of parts) if (r.of === of) byPart.set(r.part, r);
    const missing = [];
    for (let i = 1; i <= of; i++) if (!byPart.has(i)) missing.push(i);
    const ordered = [...byPart.keys()].sort((a, b) => a - b).map((k) => byPart.get(k));
    const complete = missing.length === 0;
    const listOk = complete && ordered.every((r) => r.kind === "compact") ? hash(ordered.map((r) => r.body).join("")) === parts[0].list : false;
    let tn = 0;
    const items = ordered.flatMap((r) => r.items).map((it) => {
        if (it.type !== "template" || it.line === undefined) return it;
        tn++;
        return { ...it, line: it.line.replace(/^(MUSIC|RADIO) TEMPLATE \d+/, `$1 TEMPLATE ${tn}`) };
    });
    return { complete, missing, items, listOk };
}

/** Plain names in order: asset names, then template lines (the in-game EXPORT list). */
export function namesOf(items) {
    return items.map((i) => (i.type === "template" ? i.line : i.status === "ok" || i.status === "retired" ? i.name : i.status === "unknown" ? `UNKNOWN ${i.id || i.name}` : `MALFORMED ${i.id}`));
}

export function toCsv(items) {
    const q = (s) => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    const rows = [["#", "type", "id", "name", "kind", "group", "status"]];
    items.forEach((i, n) => rows.push([n + 1, i.type, i.id ?? "", i.type === "template" ? i.line : i.name, i.kind ?? "", i.group ?? i.package ?? "", i.status]));
    return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}
