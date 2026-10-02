// Serves site/ locally, like GitHub Pages does: npm run site, then open the URL.
// The camera needs https or localhost, so use http://localhost, not a LAN address.

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = resolve(fileURLToPath(new URL("../site", import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

/** Starts the server; resolves to { url, close }. Port 0 picks a free port. */
export function serveSite(port = 0) {
    const server = createServer((req, res) => {
        const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
        let file = resolve(SITE, "." + path);
        if (file !== SITE && !file.startsWith(SITE + sep)) {
            res.writeHead(403).end();
            return;
        }
        if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, "index.html");
        if (!existsSync(file)) {
            res.writeHead(404, { "content-type": "text/plain" }).end("not found");
            return;
        }
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    });
    return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ url: `http://localhost:${server.address().port}/`, close: () => server.close() })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.argv[2] ?? 8080);
    const s = await serveSite(port);
    console.log(`  site    : ${s.url}  (Ctrl+C to stop)`);
}
