# QR codes: compact asset IDs and the companion site

The FAVOURITES tab's **QR CODE** button shows your favourites as QR codes, so console
players (who cannot open `PortalLog.txt`) can take the list with them. The codes do
not hold asset names. They hold short IDs, and a public website turns the IDs back
into names:

```
favourites in game
  -> asset names            FX_ArtilleryStrike_Explosion_01, FX_BASE_Sparks_Pulse_L, ...
  -> compact IDs            0XG, 0Y4, 0Y0, 0XS             (registry/mapping-1.json)
  -> QR payload             https://kurtinthe-grind.github.io/SfxVfxShowcase/#SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8
  -> QR code                drawn by bf6-portal-utils UIQRCode, as before
  -> phone camera           opens the link
  -> companion site         site/, on GitHub Pages
  -> names                  0XG -> FX_ArtilleryStrike_Explosion_01, ...
```

The QR code is not the database. It is a compact reference to a public mapping.

## Why IDs

A QR code holds at most 718 bytes at the size the mod draws (version 18, ECC L), and
the bigger a code gets, the harder it is to scan off a TV. Asset names are long:
about 50 bytes each. IDs are 3 bytes.

Measured by `npm run test:qr-mapping` (bytes include the 50-byte site URL):

| List | Full names | Compact IDs |
|---|---|---|
| 4 effects (the demo below) | 1 code, 138 B, 45x45 | 1 code, 82 B, 37x37 |
| 12 random assets | 1 code, 599 B, 85x85 | 1 code, 106 B, 37x37 |
| 40 random assets | 4 codes, 2,115 B | 1 code, 190 B, 49x49 |
| the Gadget group (106) | 6 codes, 3,784 B | 1 code, 388 B, 69x69 |
| every asset (1,248) | 91 codes, 62,400 B | 6 codes, 4,164 B |

One code holds about 210 assets. The old full-name codes held about 12.

## The pieces

| Path | Role |
|---|---|
| `registry/mapping-1.json` | **Source of truth.** Every ID ever given out, append-only |
| `tools/gen-ids.mjs` | Updates the registry from the catalog and writes everything derived from it (runs in `npm run gen`) |
| `tools/registry.mjs` | Assignment and validation rules (pure functions, tested directly) |
| `src/qrids.gen.ts` | The mod's lookup, generated: catalog index -> ID |
| `src/qrexport.ts` | The mod's payload builder: IDs -> payload text, split into codes |
| `src/index.ts` (`favouriteQrCodes`) | Collects the favourites' IDs and template codes in EXPORT order |
| `src/tester.ts` (`templateQrCode`) | Encodes a music or radio template |
| `src/ui.ts` (`syncQr`) | Hands each payload to the existing `UIQRCode` component, unchanged |
| `site/` | The companion website (static, no build step) |
| `site/js/codec.js` | Payload decoder (and a reference encoder), shared by the site and the tests |
| `site/data/map-1.json`, `maps.json` | The website's lookup tables, generated from the registry |
| `.github/workflows/pages.yml` | Checks the registry and deploys `site/` to GitHub Pages |

The registry is the only file anyone maintains. The mod's table and the website's
table are both generated from it, so they cannot disagree.

## How IDs are assigned

- An ID is **3 characters** from Crockford's base32 alphabet,
  `0123456789ABCDEFGHJKMNPQRSTVWXYZ`: digits and capitals without `I`, `L`, `O` and `U`,
  so nothing is ambiguous when read aloud or typed. 32^3 = 32,768 IDs; 1,308 are used.
- IDs are handed out **in sequence**: `000`, `001`, ... The first run numbered the
  catalog in its own order: sounds (`000` to `0X7`), then effects (`0X8` to `16Z`), then
  the 4 player-wide effects (`170` to `173`), then music events and music parameters.
- A new asset gets the **next unused ID**, whatever its name. IDs are never re-sorted:
  adding `SFX_AAA_New` does not move `SFX_Alarm` from `000`.
- Every ID belongs to one asset: the registry is keyed by kind and name, and validation
  rejects a duplicate ID or an asset with two IDs.

Every registry entry is one line:

```json
{ "id": "0XG", "kind": "vfx", "name": "FX_ArtilleryStrike_Explosion_01", "status": "active" }
```

`kind` is `sfx`, `vfx`, `screen` (player-wide effects, named by their id such as
`night`), `music-event` or `music-param`. Music events and parameters have IDs so that
music and radio templates can travel in a code too.

### What the build guarantees

`tools/gen-ids.mjs` runs in `npm run gen` and fails, writing nothing, if:

- two entries share an ID, or one asset has two IDs;
- an ID is not 3 valid characters, or is not below the registry's `next` counter;
- compared with the committed registry (`git show HEAD:`), an ID was deleted, changed
  meaning, or `next` went backwards (which would let an ID be reused);
- (`--check`, used by CI) the generated files are out of date with the registry.

`tools/test-qr-mapping.mjs` also checks that `src/qrids.gen.ts` and `site/data/maps.json`
name the same mapping and format, so the mod can never write codes the site cannot read.

## Payload format

```
SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8
|  | | | |    |            |
|  | | | |    |            check: 4-char hash of everything before the last "."
|  | | | |    body: IDs, 3 chars each, then "~"-prefixed templates
|  | | | list: 4-char hash of the whole list's body (all parts joined)
|  | | of: number of codes in this list
|  | part: which code this is
|  mapping: which ID table (site/data/map-1.json)
SV + format version (1)
```

In the code, the payload sits behind the site URL and `#`
(`CONFIG.qrSite` in `src/config.ts`), so a phone camera opens the decoder directly. The
part after `#` never reaches a server. Set `qrSite` to `""` to put the bare payload in
the code instead; the site's paste box reads either.

Header and checksums cost 20 bytes per code. The checksums catch a damaged or
hand-edited payload. QR codes already correct scanning errors, so these guard against
truncation and typos, not attacks. Anyone can compute them; they are not security.

**Order and repeats.** IDs are written in the favourites' order (the EXPORT order:
assets, then templates). The format keeps repeats as written; favourites cannot hold
the same asset twice, so the mod never writes one, but the site numbers repeats if a
code has them.

**Templates.** After the IDs, each template starts with `~`:

```
~M17N,18H0,18J0,18K0,18M0,18G1          music: event ID, then param ID + value pairs
~R,18Q0,18R2,18S1,18T1,18P1;2.0.3;2.0.4  radio: param ID + value pairs, then ;channel.biome.track picks
```

The site rebuilds the same line EXPORT writes (`MUSIC TEMPLATE 1 | Core | ...`). A radio
queue too long for one code keeps its first picks.

**Long lists** are split between items, never inside one. Each code decodes on its own.
The site remembers the parts you have scanned (in your browser), says which are still
missing, and joins them once the `list` hash of the joined bodies matches.

## The companion site

Plain HTML, CSS and JavaScript in `site/`, with no build step and no server code:

- **Open camera** reads codes live (the browser's `BarcodeDetector` where it exists,
  [jsQR](https://github.com/cozmo/jsQR) elsewhere, vendored in `site/vendor/`).
- **Upload QR image** reads a photo or screenshot.
- **Paste QR data** takes a payload, a decoder link, bare IDs (`0XG 0Y4`), or a pasted
  EXPORT log.
- A decoder link (`...#SV1...`) decodes on load. That is what a phone camera opens.

It shows each name with its kind, group and ID, plus the format version, mapping version,
assets found, unknown assets and checksum. You can copy the list, download it as JSON or
CSV, or copy a link to the code. **Developer view** shows the exact payload, the header
fields, the body split into IDs, and an ID -> name table. **Look up an asset or ID**
searches the whole mapping.

What it reports instead of guessing:

| Case | Shown as |
|---|---|
| Unknown ID (`ZZZ`) | kept in place: `⚠ Unknown Asset ID: ZZZ`, with the known ID range |
| Malformed ID (not 3 alphabet characters) | `⚠ Malformed ID` |
| Retired asset | its old name, marked RETIRED |
| Checksum mismatch, damaged header | "Could not decode", with the reason |
| Format version it does not read (`SV2`) | unsupported format: reload for a newer decoder |
| Mapping it does not have | unsupported mapping |
| Someone else's QR code, binary data | "not an SFX/VFX Showcase code" |
| Over 4,096 characters or 2,000 items | refused as too large |

Nothing you scan or paste leaves the browser. The mapping is public, as is the
registry in this repository. The IDs are identifiers, not encryption.

### Hosting

`.github/workflows/pages.yml` runs on every push to `master` that touches `site/`,
`registry/` or the ID tools. It first runs `node tools/gen-ids.mjs --check`, then publishes
`site/` to **https://kurtinthe-grind.github.io/SfxVfxShowcase/**.

One-time setup: on GitHub, open the repository's **Settings > Pages**, and under
**Build and deployment** set **Source** to **GitHub Actions**. A fork publishes to its own
`<owner>.github.io/<repo>/`; point `CONFIG.qrSite` at it.

To try the site locally: `npm run site`, then open http://localhost:8080/ (the camera
needs `localhost` or https).

## Maintaining the mapping

### Adding assets

Nothing to do by hand. When the SDK adds assets, `npm run gen` regenerates the catalog,
and `tools/gen-ids.mjs` gives each new asset the next unused ID and prints
`ids: ... N added`. Commit `registry/mapping-1.json` together with `src/qrids.gen.ts` and
`site/data/`. The registry diff shows exactly the new lines at the end.

### Retiring assets

Also automatic. An asset that leaves the catalog (removed from the SDK, or added to
`banlist.json`) is marked `"status": "retired"`. Its line and ID stay. The ID is never
handed out again, and old codes still show its name, marked RETIRED. If the asset comes
back, it is reactivated with its old ID.

Never delete a registry line or edit an `id`, `kind` or `name`. The build refuses both.

### Regenerating

```bash
npm run gen                 # everything, including the ID tables
node tools/gen-ids.mjs      # only the registry and ID tables
node tools/gen-ids.mjs --check   # verify, write nothing (what CI runs)
```

### A new mapping version

Only for a clean break, for example a different ID width. Adding or retiring assets
never needs one.

1. Create `registry/mapping-2.json`:
   `{ "mapping": 2, "alphabet": "0123456789ABCDEFGHJKMNPQRSTVWXYZ", "width": 3, "next": 0, "assets": [] }`.
2. Run `npm run gen`. The highest-numbered registry is current: it is filled from the
   catalog, `src/qrids.gen.ts` switches the mod to mapping 2, and `site/data/map-2.json` is
   written.
3. `mapping-1.json` is frozen from then on: still validated, still published as
   `site/data/map-1.json`, never changed. Codes that say mapping 1 keep decoding with it.

A change to the payload layout itself is a new **format** version (`SV2`): bump `FORMAT`
in `site/js/codec.js` (`tools/gen-ids.mjs` copies it into `src/qrids.gen.ts` as
`QR_FORMAT`), change `src/qrexport.ts` to match, and teach `parseCompact` to read the new
layout while still reading format 1.

## Backward compatibility

- **Codes from builds before this change** held full names: a header line
  `SFX/VFX SHOWCASE FAVOURITES 1/2`, then one name or template line per line. The site
  detects these, shows the names as written, and adds the ID each name has today. It
  also reads a pasted EXPORT log.
- **Codes from this build onward** keep decoding as long as their mapping is published.
  The registry rules above make sure an ID never changes meaning, and
  `tools/test-qr-mapping.mjs` decodes a frozen code made with this build, which must
  always read the same four names.
- **A code from a newer build** (new assets) shows the new IDs as unknown until the site
  is redeployed. The site lists the ID range it knows, so this is easy to spot.

## Developer and debug tools

- **In game**: DEBUG ON, then QR CODE. The log shows each favourite's transformation and
  the exact payload handed to the QR component:

  ```
  QR MAP FX_ArtilleryStrike_Explosion_01 -> 0XG
  QR MAP FX_BASE_Sparks_Pulse_L -> 0Y4
  QR TEXT 1/1: "https://kurtinthe-grind.github.io/SfxVfxShowcase/#SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8"
  ```

- **On the command line**:

  ```bash
  npm run qr:inspect -- FX_ArtilleryStrike_Explosion_01 FX_BASE_Fire_M_NoSmoke   # names -> IDs -> payload
  npm run qr:inspect -- "SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8"                        # payload -> names
  ```

- **On the site**: Developer view, under any result.

## Tests

| Command | What it proves |
|---|---|
| `npm run test:qr` (in `npm run build`) | End to end on `dist/bundle.ts`: the demo list becomes its four IDs; the drawn code matches the encoder's matrix square by square; **jsQR reads the drawn code back** and the site's decoder returns the EXPORT list; the mod's payloads equal the codec's byte for byte; a 256-item list splits into 2 codes, each scanned and rejoined |
| `npm run test:qr-mapping` (in `npm run build`) | 84 checks: one asset, every asset, repeats, unknown ID, corrupt/truncated/foreign payloads, old and new mapping versions, a frozen code, legacy full-name codes, adding an asset (no ID moves), removing one (retired, never reused), registry validation, templates, mod/codec parity on 200 random lists, payload sizes |
| `npm run test:site` | The real page in headless Chromium: a decoder link, **an uploaded image of the code**, paste, unknown/corrupt/foreign/legacy codes, a two-part list, JSON/CSV downloads, lookup, no sideways scroll at 390 px. Needs Playwright (see the file header) |

### The demonstration

`npm run test:qr` runs this workflow on the real bundle and prints it:

```
qr demo    : FX_ArtilleryStrike_Explosion_01 -> 0XG, FX_BASE_Sparks_Pulse_L -> 0Y4, FX_BASE_Smoke_Pillar_Black_L -> 0Y0, FX_BASE_Fire_M_NoSmoke -> 0XS
qr demo    : payload "https://kurtinthe-grind.github.io/SfxVfxShowcase/#SV1.1.1-1.TSTD.0XG0Y40Y00XS.W5G8"
qr demo    : camera read it back, site expanded it to FX_ArtilleryStrike_Explosion_01, FX_BASE_Sparks_Pulse_L, FX_BASE_Smoke_Pillar_Black_L, FX_BASE_Fire_M_NoSmoke
qr demo    : 82 bytes (32 without the URL), 37 squares wide; full names: 138 bytes, 45 squares
```

The names `Explosion_Large_01` and the like in the original brief are not real Portal
assets, so the demonstration uses an explosion, sparks, smoke and fire from the actual
catalog.
