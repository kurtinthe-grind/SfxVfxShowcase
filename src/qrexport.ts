// Packs favourites into plain-text QR payloads for console players.
export const QR_BYTES = 718;

const HEADER = "SFX/VFX SHOWCASE FAVOURITES ";

function header(part: number, of: number): string {
    return HEADER + part + "/" + of;
}

/** Splits lines into QR_BYTES payloads without splitting a line. */
export function packQrTexts(lines: readonly string[]): string[] {
    if (lines.length === 0) return [];
    // Reserve room for the widest "99/99" header.
    const room = QR_BYTES - (header(99, 99).length + 1);
    const parts: string[][] = [];
    let cur: string[] = [];
    let used = 0;
    for (const raw of lines) {
        const line = raw.length > room ? raw.slice(0, room) : raw;
        const cost = line.length + (cur.length > 0 ? 1 : 0);
        if (cur.length > 0 && used + cost > room) {
            parts.push(cur);
            cur = [];
            used = 0;
        }
        used += line.length + (cur.length > 0 ? 1 : 0);
        cur.push(line);
    }
    parts.push(cur);
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) out.push(header(i + 1, parts.length) + "\n" + parts[i].join("\n"));
    return out;
}
