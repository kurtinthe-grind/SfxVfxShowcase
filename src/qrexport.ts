// Packs favourites into compact QR payloads: stable IDs, not names.
// Format and IDs: docs/QR-MAPPING.md. site/js/codec.js decodes; tools/test-qr-mapping.mjs keeps the two in step.
import { QR_FORMAT, QR_MAPPING } from "./qrids.gen";

export const QR_BYTES = 718;

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HASH_MOD = 1048573;

/** ID number -> fixed-width base32 text. */
export function qrId(n: number, width: number = 3): string {
    let s = "";
    for (let i = 0; i < width; i++) {
        s = ALPHABET.charAt(n % 32) + s;
        n = Math.floor(n / 32);
    }
    return s;
}

/** Catalog index -> ID number; runs are [first index, its ID, ...]. */
export function runId(runs: readonly number[], index: number): number {
    let at = 0;
    for (let i = 0; i < runs.length; i += 2) if (runs[i] <= index) at = i;
    return runs[at + 1] + (index - runs[at]);
}

/** Template values as the codec reads them: at most 2 decimals. */
export function qrNum(v: number): string {
    return String(Math.round(v * 100) / 100);
}

function hash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % HASH_MOD;
    return qrId(h, 4);
}

function header(part: number, of: number, list: string): string {
    return "SV" + QR_FORMAT + "." + QR_MAPPING + "." + part + "-" + of + "." + list + ".";
}

// A radio queue too long for one code keeps its first picks.
function fit(code: string, room: number): string {
    let cut = code;
    while (cut.length > room && cut.lastIndexOf(";") > 0) cut = cut.slice(0, cut.lastIndexOf(";"));
    return cut;
}

/** Splits item codes into payloads of at most QR_BYTES without splitting an item. */
export function packQrPayloads(codes: readonly string[], prefix: string): string[] {
    if (codes.length === 0) return [];
    const room = QR_BYTES - prefix.length - header(99, 99, "0000").length - 5;
    const parts: string[] = [];
    let cur = "";
    for (const raw of codes) {
        const code = fit(raw, room);
        if (cur !== "" && cur.length + code.length > room) {
            parts.push(cur);
            cur = "";
        }
        cur += code;
    }
    parts.push(cur);
    const list = hash(parts.join(""));
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        const head = header(i + 1, parts.length, list) + parts[i];
        out.push(prefix + head + "." + hash(head));
    }
    return out;
}
