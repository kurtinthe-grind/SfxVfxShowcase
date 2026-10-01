import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = parseInt(process.argv[2] || '8081', 10);
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

// ---- SSE clients for hot-reload ----
const clients = new Set();

function notifyReload() {
    for (const res of clients) {
        res.write('data: reload\n\n');
    }
}

// ---- Watch src/ for changes ----
watch(join(ROOT, 'src'), { recursive: true }, (_event, filename) => {
    if (filename) {
        console.log(`\x1b[36m[hot-reload]\x1b[0m ${filename} changed`);
        notifyReload();
    }
});

// ---- HTTP Server ----
const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    // SSE endpoint for hot-reload
    if (pathname === '/__reload') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        res.write('data: connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    // Resolve file path
    if (pathname === '/') pathname = '/index.html';
    const filePath = join(ROOT, pathname);

    // Security: prevent path traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    try {
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('Not a file');

        const ext = extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        const body = await readFile(filePath);

        res.writeHead(200, {
            'Content-Type': mime,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
        });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`\x1b[32mBF6 UI Preview\x1b[0m  http://localhost:${PORT}`);
    console.log(`\x1b[90mHot-reload active — watching src/\x1b[0m`);
});
