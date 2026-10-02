// Packs the favourites into QR code texts for the QR CODE panel.
//
// Console players cannot open PortalLog.txt, so EXPORT FAVOURITES does nothing for
// them. QR CODE shows the same list as QR codes holding plain text: a phone camera
// shows the text and the player copies it. Nothing is hosted anywhere.
// (Suggested by mikedeluca_, the author of bf6-portal-utils.)
//
// One code holds QR_BYTES; a longer list is split into parts, each with a header
// line "SFX/VFX SHOWCASE FAVOURITES i/n" so a player can tell the pieces apart.

/**
 * The most text one code carries: QR version 18 at error correction L, the
 * largest code UIQRCode draws (UIQRCode.MAX_QR_VERSION). ECC L is enough for a
 * code shown on a screen, and it leaves the most room for names.
 */
export const QR_BYTES = 718;

const HEADER = "SFX/VFX SHOWCASE FAVOURITES ";

function header(part: number, of: number): string {
    return HEADER + part + "/" + of;
}

/**
 * Splits `lines` into code texts, in order, each at most QR_BYTES. A line is
 * never split. Returns [] for no lines. The text is ASCII (asset names and
 * template lines), so a character is a byte.
 */
export function packQrTexts(lines: readonly string[]): string[] {
    if (lines.length === 0) return [];
    // Room for the longest header this list could need ("99/99"), so the count
    // can be filled in after packing without overflowing a part.
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
