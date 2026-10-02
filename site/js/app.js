// Companion page: reads a code (camera, image, paste or link), decodes it with
// codec.js against the published mapping, and shows the full asset names.
// Everything runs in the browser; scanned text is never sent anywhere.

import { combineParts, decode, namesOf, toCsv } from "./codec.js";
import { scanImageFile, startCamera } from "./scanner.js";

const $ = (id) => document.getElementById(id);
const PARTS_KEY = "svqr-parts";
const KIND_TAG = { sfx: "SFX", vfx: "VFX", screen: "SCREEN", music: "MUSIC", radio: "RADIO" };

const state = { maps: {}, current: 1, index: undefined, result: undefined, combined: undefined, showAll: false, stopCamera: undefined };

/** Element with text children only: decoded text is untrusted and never parsed as HTML. */
function el(tag, props = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === false) continue;
        if (k === "class") e.className = v;
        else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
}

function say(text) {
    $("input-status").textContent = text;
}

// ---------------------------------------------------------------- data

async function loadMaps() {
    const index = await fetch("data/maps.json", { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(`data/maps.json: HTTP ${r.status}`);
        return r.json();
    });
    state.index = index;
    state.current = index.current;
    await Promise.all(
        Object.entries(index.mappings).map(async ([id, file]) => {
            const r = await fetch("data/" + file, { cache: "no-cache" });
            if (!r.ok) throw new Error(`data/${file}: HTTP ${r.status}`);
            state.maps[id] = await r.json();
        }),
    );
    const cur = state.maps[state.current];
    $("foot-map").textContent = `Mapping ${state.current}: ${cur.count} IDs. Reads QR format ${index.formats.join(", ")}.`;
}

// ---------------------------------------------------------------- multi-part lists

function readParts() {
    try {
        return JSON.parse(localStorage.getItem(PARTS_KEY) ?? "{}") ?? {};
    } catch {
        return {};
    }
}

function writeParts(all) {
    try {
        const keep = Object.entries(all)
            .sort((a, b) => b[1].t - a[1].t)
            .slice(0, 20);
        localStorage.setItem(PARTS_KEY, JSON.stringify(Object.fromEntries(keep)));
    } catch {
        // storage blocked: parts are just not remembered between scans
    }
}

/** Remembers a part of a split list and returns every remembered part of it, decoded. */
function rememberPart(r) {
    const all = readParts();
    const entry = all[r.list] ?? { of: r.of, parts: {}, t: 0 };
    entry.parts[r.part] = r.payload;
    entry.t = Date.now();
    all[r.list] = entry;
    writeParts(all);
    return Object.values(entry.parts).map((p) => decode(p, state.maps, state.current)).filter((x) => x.list === r.list && x.checkOk);
}

function forgetParts(list) {
    const all = readParts();
    delete all[list];
    writeParts(all);
}

// ---------------------------------------------------------------- decoding

function show(text, source) {
    const r = decode(text, state.maps, state.current);
    state.result = r;
    state.combined = undefined;
    state.showAll = false;
    if (r.kind === "compact" && r.of > 1 && r.checkOk) {
        const got = rememberPart(r);
        state.combined = { ...combineParts(got), parts: got.map((g) => g.part).sort((a, b) => a - b) };
        state.showAll = state.combined.complete;
    }
    if (r.kind === "compact" && r.status !== "error") {
        try {
            history.replaceState(null, "", "#" + r.payload);
        } catch {
            // file:// pages may refuse; the page still works
        }
    }
    say(source !== undefined ? `Read from ${source}.` : "");
    render();
    $("result").hidden = false;
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------- rendering

function itemsInView() {
    const r = state.result;
    if (state.showAll && state.combined?.complete) return state.combined.items;
    return r.items;
}

/** Lets long enum names wrap after "_" instead of mid-word. */
function breakable(text) {
    const out = [];
    text.split("_").forEach((piece, i, all) => {
        out.push(i < all.length - 1 ? piece + "_" : piece);
        if (i < all.length - 1) out.push(el("wbr"));
    });
    return out;
}

function assetRow(it, n) {
    const tags = [];
    if (KIND_TAG[it.kind] !== undefined) tags.push(el("span", { class: "tag" }, KIND_TAG[it.kind]));
    if (it.status === "retired") tags.push(el("span", { class: "tag warn" }, "RETIRED"));
    if (it.status === "unknown") tags.push(el("span", { class: "tag err" }, "UNKNOWN"));
    if (it.status === "malformed") tags.push(el("span", { class: "tag err" }, "MALFORMED"));
    if (it.repeat !== undefined) tags.push(el("span", { class: "tag" }, `REPEAT ${it.repeat}`));
    if (it.id) tags.push(el("span", { class: "tag id", title: "Compact ID" }, it.id));

    let name;
    if (it.type === "template") name = it.line;
    else if (it.status === "unknown") name = it.id ? `⚠ Unknown Asset ID: ${it.id}` : `⚠ Unknown asset: ${it.name}`;
    else if (it.status === "malformed") name = `⚠ Malformed ID: ${it.id}`;
    else name = it.name;

    const details = [];
    if (it.type === "asset" && it.group) details.push(it.group);
    if (it.kind === "screen" && it.enumName !== undefined) details.push(`player-wide effect "${it.enumName}"`);
    if (it.note) details.push(it.note);
    if (it.issues?.length) details.push(it.issues.join("; "));

    return el(
        "li",
        { class: it.status },
        el("span", { class: "num" }, n + "."),
        el("span", { class: "name" }, breakable(name)),
        el("span", { class: "tags" }, tags),
        details.length > 0 ? el("span", { class: "detail" }, details.join(" · ")) : undefined,
    );
}

function metaRow(label, value) {
    return el("div", {}, el("dt", {}, label), el("dd", {}, value));
}

function render() {
    const r = state.result;
    const items = itemsInView();
    const st = r.stats;

    const pill = $("result-pill");
    pill.className = "pill " + r.status;
    pill.textContent = r.status === "ok" ? "Decoded" : r.status === "warning" ? "Decoded with warnings" : "Could not decode";

    const msgs = $("messages");
    msgs.replaceChildren(...r.errors.map((e) => el("li", { class: "error" }, e.message)), ...r.warnings.map((w) => el("li", { class: "warning" }, w.message)));

    const format = r.kind === "compact" ? String(r.formatVersion ?? "?") : r.kind === "legacy" ? "Legacy (full names)" : r.kind === "bare" ? "Bare IDs (no header)" : "—";
    const viewStats = state.showAll && state.combined?.complete ? statsOf(items) : st;
    const meta = [
        metaRow("Format version", format),
        metaRow("Mapping version", r.mapping !== undefined ? String(r.mapping) : "—"),
        metaRow("Assets found", String(viewStats.known)),
        metaRow("Unknown assets", String(viewStats.unknown)),
    ];
    if (r.of > 1) meta.push(metaRow("Part", state.showAll ? `all ${r.of}` : `${r.part} of ${r.of}`));
    if (viewStats.templates > 0) meta.push(metaRow("Templates", String(viewStats.templates)));
    if (viewStats.malformed > 0) meta.push(metaRow("Malformed", String(viewStats.malformed)));
    if (viewStats.retired > 0) meta.push(metaRow("Retired", String(viewStats.retired)));
    if (viewStats.repeated > 0) meta.push(metaRow("Repeats", String(viewStats.repeated)));
    if (r.kind === "compact") meta.push(metaRow("Checksum", r.checkOk ? "OK" : "Mismatch"));
    $("meta").replaceChildren(...meta);

    const parts = $("parts");
    parts.hidden = state.combined === undefined;
    if (state.combined !== undefined) {
        const c = state.combined;
        const view = $("btn-parts-view");
        if (c.complete) {
            $("parts-text").textContent = c.listOk
                ? `All ${r.of} parts of this list are scanned (${c.items.length} items).`
                : `All ${r.of} parts are here, but they do not add up to the list they came from. Rescan them.`;
            view.hidden = false;
            view.textContent = state.showAll ? `Show only part ${r.part}` : `Show the whole list (${c.items.length} items)`;
        } else {
            $("parts-text").textContent = `This list is split into ${r.of} codes. Scanned: part ${c.parts.join(", ")}. Still needed: part ${c.missing.join(", ")}.`;
            view.hidden = true;
        }
    }

    $("assets").replaceChildren(...items.map((it, i) => assetRow(it, i + 1)));
    $("result-h").textContent = r.kind === "legacy" || r.kind === "compact" || r.kind === "bare" ? "Experience Assets" : "Result";
    for (const b of document.querySelectorAll("[data-export]")) b.disabled = items.length === 0 || (b.dataset.export === "link" && r.kind !== "compact");
    renderDebug(items);
}

function statsOf(items) {
    const a = items.filter((i) => i.type === "asset");
    return {
        known: a.filter((i) => i.status === "ok" || i.status === "retired").length,
        unknown: a.filter((i) => i.status === "unknown").length,
        malformed: items.filter((i) => i.status === "malformed").length,
        retired: a.filter((i) => i.status === "retired").length,
        repeated: a.filter((i) => i.repeat !== undefined).length,
        templates: items.filter((i) => i.type === "template").length,
    };
}

function renderDebug(items) {
    const r = state.result;
    const rows = items.map((it, i) =>
        el("tr", {}, el("td", {}, String(i + 1)), el("td", {}, it.id || (it.raw ?? "")), el("td", {}, it.type === "template" ? it.line : it.enumName ?? it.name ?? ""), el("td", {}, it.status)),
    );
    const head = r.kind === "compact" ? `SV${r.formatVersion} . mapping ${r.mapping} . part ${r.part}-${r.of} . list ${r.list} . body (${r.body.length} chars) . check ${r.checkOk ? "OK" : "BAD"}` : r.kind;
    const segments = r.kind === "compact" || r.kind === "bare" ? (r.body.split("~")[0].match(/.{1,3}/g) ?? []).join(" ") + (r.body.includes("~") ? "  ~" + r.body.split("~").slice(1).join(" ~") : "") : "";
    $("debug-body").replaceChildren(
        el("p", { class: "hint" }, "Exact text read from the code:"),
        el("pre", {}, r.payload),
        el("p", { class: "hint" }, "Header:"),
        el("pre", {}, head),
        segments !== "" ? el("p", { class: "hint" }, "Body split into IDs:") : undefined,
        segments !== "" ? el("pre", {}, segments) : undefined,
        el("p", { class: "hint" }, "Compact ID → full name:"),
        el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, "ID"), el("th", {}, "Name"), el("th", {}, "Status"))), el("tbody", {}, rows)),
    );
}

// ---------------------------------------------------------------- exports

function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text, what) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const t = el("textarea", { class: "sr-only" });
        t.value = text;
        document.body.append(t);
        t.select();
        document.execCommand("copy");
        t.remove();
    }
    say(`Copied ${what}.`);
}

function onExport(kind) {
    const r = state.result;
    const items = itemsInView();
    const stem = r.list ? `sfxvfx-${r.list}` : "sfxvfx-assets";
    if (kind === "copy") copy(namesOf(items).join("\n") + "\n", `${items.length} lines`);
    if (kind === "csv") download(stem + ".csv", "text/csv", toCsv(items));
    if (kind === "json") {
        const out = {
            format: r.kind === "compact" ? r.formatVersion : r.kind,
            mapping: r.mapping,
            part: state.showAll ? undefined : r.part,
            of: r.of,
            payload: r.payload,
            items: items.map((i) => (i.type === "template" ? { type: "template", kind: i.kind, line: i.line, status: i.status } : { type: "asset", id: i.id, name: i.name, enum: i.enumName, kind: i.kind, group: i.group, status: i.status })),
        };
        download(stem + ".json", "application/json", JSON.stringify(out, null, 2) + "\n");
    }
    if (kind === "link") copy(location.origin + location.pathname + "#" + r.payload, "the link");
}

// ---------------------------------------------------------------- lookup

function renderLookup() {
    const q = $("lookup-q").value.trim().toLowerCase();
    const map = state.maps[state.current];
    if (map === undefined) return;
    const all = Object.entries(map.ids).filter(([, e]) => e.k !== "music-param");
    const hits = q === "" ? [] : all.filter(([id, e]) => id.toLowerCase() === q || e.n.toLowerCase().includes(q) || (e.l ?? "").toLowerCase().includes(q) || (e.g ?? "").toLowerCase().includes(q));
    $("lookup-count").textContent = q === "" ? `${all.length} assets and music events. Type to search.` : `${hits.length} match${hits.length === 1 ? "" : "es"}${hits.length > 60 ? ", first 60 shown" : ""}.`;
    $("lookup-list").replaceChildren(
        ...hits.slice(0, 60).map(([id, e], i) =>
            assetRow({ type: "asset", id, name: e.l ?? e.n, enumName: e.n, kind: e.k === "music-event" ? "music" : e.k, group: e.g, status: e.s === "retired" ? "retired" : "ok" }, i + 1),
        ),
    );
}

// ---------------------------------------------------------------- wiring

async function openCamera() {
    if (state.stopCamera !== undefined) return;
    $("camera").hidden = false;
    $("paste").hidden = true;
    say("Point the camera at the code on screen.");
    try {
        state.stopCamera = await startCamera($("video"), (text) => {
            state.stopCamera = undefined;
            $("camera").hidden = true;
            show(text, "the camera");
        });
    } catch (e) {
        state.stopCamera = undefined;
        $("camera").hidden = true;
        say(e?.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser, or use Upload QR image." : `Could not open the camera: ${e?.message ?? e}`);
    }
}

function closeCamera() {
    state.stopCamera?.();
    state.stopCamera = undefined;
    $("camera").hidden = true;
    say("");
}

function wire() {
    $("btn-camera").addEventListener("click", openCamera);
    $("btn-camera-stop").addEventListener("click", closeCamera);
    $("btn-paste").addEventListener("click", () => {
        closeCamera();
        $("paste").hidden = !$("paste").hidden;
        if (!$("paste").hidden) $("paste-text").focus();
    });
    $("paste").addEventListener("submit", (ev) => {
        ev.preventDefault();
        show($("paste-text").value, "pasted text");
    });
    $("file").addEventListener("change", async () => {
        const f = $("file").files?.[0];
        $("file").value = "";
        if (f === undefined) return;
        closeCamera();
        say("Reading the image...");
        try {
            const text = await scanImageFile(f);
            if (text === undefined) say("No QR code found in that image. Try a sharper or closer photo.");
            else show(text, f.name);
        } catch (e) {
            say(`Could not read that image: ${e?.message ?? e}`);
        }
    });
    $("btn-parts-view").addEventListener("click", () => {
        state.showAll = !state.showAll;
        render();
    });
    $("btn-parts-clear").addEventListener("click", () => {
        forgetParts(state.result.list);
        state.combined = undefined;
        state.showAll = false;
        render();
        say("Forgot the scanned parts of this list.");
    });
    for (const b of document.querySelectorAll("[data-export]")) b.addEventListener("click", () => onExport(b.dataset.export));
    $("lookup-q").addEventListener("input", renderLookup);
    window.addEventListener("hashchange", () => {
        if (location.hash.length > 1 && location.hash.slice(1) !== state.result?.payload) show(location.hash.slice(1), "the link");
    });
}

async function main() {
    wire();
    try {
        await loadMaps();
    } catch (e) {
        say(`Could not load the asset mapping: ${e?.message ?? e}. Reload the page.`);
        $("foot-map").textContent = "Mapping not loaded.";
        return;
    }
    renderLookup();
    if (location.hash.length > 1) show(location.hash.slice(1), "the link");
    document.body.dataset.ready = "1";
}

main();
