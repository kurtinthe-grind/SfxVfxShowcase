// Tunables. Anything a designer might want to twist lives here.

export const CONFIG = {
    // Aim raycast from the soldier's eyes when the portal gadget is fired.
    rayLength: 100,

    // Row glyphs for the ACTION column: P auditions the sound in place, S spawns
    // the effect in the world, T toggles a player-wide effect. ASCII on purpose --
    // Portal's UI font has no arbitrary UTF-8, so the triangles and circles these
    // replaced rendered as "*".
    playGlyph: "P",
    spawnGlyph: "S",
    effectGlyph: "T",

    // ---- SFX ----
    defaultAmplitude: 0.8,
    amplitudeStep: 0.1,
    minAmplitude: 0.1,
    maxAmplitude: 1.0,

    defaultRange: 40,
    rangeStep: 10,
    minRange: 10,
    maxRange: 120,

    // ---- VFX ----
    // mod.SetVFXScale takes an engine-specific multiplier. Range is a guess and
    // wants an in-game pass: if an effect vanishes at the top of the range, the
    // engine's usable band is narrower than assumed.
    defaultScale: 1.0,
    scaleStep: 0.1,
    minScale: 0.25,
    maxScale: 4.0,

    // VFX are persistent once placed; this is the ceiling on concurrent effects
    // per player before the oldest is auto-removed. Undo/Delete All work below it.
    maxSpawnedPerPlayer: 24,

    // How many VFX groups the rail shows. The rail fits RAIL.visibleRows rows and
    // there are 52 VFX groups, so this is a shortlist, not a full list.
    vfxTopGroups: 28,

    vfxColor: [1.0, 1.0, 1.0] as const,

    // ---- UI loading ----
    // The open menu is ~328 engine widgets. Creating ~245 of them in the tick the
    // menu opens now crashes the game, so at most widgetsPerBatch NEW elements are
    // created per batch, one batch every widgetBatchDelayMs. An element is a
    // bf6-portal-utils component, and a text button is three engine widgets
    // (container + button + text), so 30 elements is up to ~80 engine widgets.
    // 30 / 100 ms builds the open menu in five batches, about half a second.
    // Lower the batch or raise the delay if it still crashes.
    widgetsPerBatch: 30,
    widgetBatchDelayMs: 100,
} as const;
