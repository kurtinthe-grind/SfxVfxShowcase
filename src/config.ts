// Tunables.
export const CONFIG = {
    rayLength: 100,

    // ASCII glyphs: Portal's font has no UTF-8.
    playGlyph: "P",
    spawnGlyph: "S",
    effectGlyph: "T",

    defaultAmplitude: 0.8,
    amplitudeStep: 0.1,
    minAmplitude: 0.1,
    maxAmplitude: 1.0,

    // Cap concurrent sounds per player; oldest stops first.
    maxSoundsPerPlayer: 16,

    defaultRange: 40,
    rangeStep: 10,
    minRange: 10,
    maxRange: 120,

    // Scale range is an engine guess; verify in game.
    defaultScale: 1.0,
    scaleStep: 0.1,
    minScale: 0.25,
    maxScale: 4.0,

    // Cap concurrent placed effects; oldest is removed.
    maxSpawnedPerPlayer: 24,

    // Number of VFX groups shown on the rail.
    vfxTopGroups: 28,

    vfxColor: [1.0, 1.0, 1.0] as const,

    // Build the menu in batches; one widget burst can crash.
    // Lower the batch if opening still crashes.
    widgetsPerBatch: 30,
    widgetBatchDelayMs: 100,

    // QR codes draw across ticks; lower this if drawing hitches.
    qrWidgetsPerTick: 30,

    // Calls within musicLoadMs of LoadMusic are held, then sent.
    musicLoadMs: 5000,

    uiSoundMs: 2000,
    uiSoundAmp: 1.0,
} as const;
