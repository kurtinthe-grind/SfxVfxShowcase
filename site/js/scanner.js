// Reads QR codes from the camera or an image file. Uses the browser's own
// BarcodeDetector where it exists (Chrome on Android), jsQR everywhere else.

let jsqrLoading;

// The UMD build sets window.jsQR to { default: fn }.
const jsqrFn = () => (typeof globalThis.jsQR === "function" ? globalThis.jsQR : globalThis.jsQR?.default);

function loadJsQR() {
    if (jsqrFn() !== undefined) return Promise.resolve(jsqrFn());
    jsqrLoading ??= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = new URL("../vendor/jsQR.js", import.meta.url).href;
        s.onload = () => (typeof jsqrFn() === "function" ? resolve(jsqrFn()) : reject(new Error("The QR reader (vendor/jsQR.js) did not load.")));
        s.onerror = () => reject(new Error("Could not load the QR reader (vendor/jsQR.js)."));
        document.head.appendChild(s);
    });
    return jsqrLoading;
}

async function nativeDetector() {
    if (!("BarcodeDetector" in globalThis)) return undefined;
    try {
        const formats = await globalThis.BarcodeDetector.getSupportedFormats();
        return formats.includes("qr_code") ? new globalThis.BarcodeDetector({ formats: ["qr_code"] }) : undefined;
    } catch {
        return undefined;
    }
}

/** Text of the first QR code in a canvas, or undefined. */
async function readCanvas(canvas, ctx, detector, thorough) {
    if (detector !== undefined) {
        try {
            const found = await detector.detect(canvas);
            if (found.length > 0) return found[0].rawValue;
        } catch {
            // fall through to jsQR
        }
    }
    const jsQR = await loadJsQR();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: thorough ? "attemptBoth" : "dontInvert" })?.data;
}

/** Decodes a QR code in an image file; resolves to its text or undefined. */
export async function scanImageFile(file) {
    const bitmap = await createImageBitmap(file);
    const detector = await nativeDetector();
    // Try the image at a size jsQR handles well, then at full size for dense codes.
    for (const max of [1200, 2400]) {
        const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * k);
        canvas.height = Math.round(bitmap.height * k);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const text = await readCanvas(canvas, ctx, detector, true);
        if (text !== undefined) return text;
        if (k === 1) break;
    }
    return undefined;
}

/**
 * Starts the rear camera in `video` and calls onText once with the first code
 * read. Returns a stop function. Throws if the camera cannot be opened.
 */
export async function startCamera(video, onText) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera here. Use Upload QR image instead.");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    const detector = await nativeDetector();
    if (detector === undefined) await loadJsQR();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let running = true;
    let busy = false;
    const stop = () => {
        running = false;
        for (const t of stream.getTracks()) t.stop();
        video.srcObject = null;
    };
    const tick = async () => {
        if (!running) return;
        if (!busy && video.readyState >= 2 && video.videoWidth > 0) {
            busy = true;
            const k = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * k);
            canvas.height = Math.round(video.videoHeight * k);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const text = await readCanvas(canvas, ctx, detector, false);
            busy = false;
            if (text !== undefined && running) {
                stop();
                onText(text);
                return;
            }
        }
        setTimeout(tick, 120);
    };
    tick();
    return stop;
}
