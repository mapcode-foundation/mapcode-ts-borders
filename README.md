# mapcode-ts-borders

OpenStreetMap administrative borders for [mapcode-ts](https://github.com/mapcode-foundation/mapcode-ts). Give it a point and it tells you which territories contain it: `US-CA` and `USA` for Los Angeles, nothing for the North Sea. It also reorders a list of mapcodes so the territory the point is really in comes first.

Plain `encode()` returns every mapcode whose territory rectangle contains the point. Near a border that includes territories the point is not in. This package settles it with real border polygons, and leaves `mapcode-ts` untouched.

## Install

```
npm install mapcode-ts mapcode-ts-borders
```

`mapcode-ts` is a peer dependency (`^1.0.3`). Node 20 or later. There are no other runtime dependencies.

## Usage in Node

The border data ships as `data/borders.mcb` (about 23 MB). `bordersUrl` points at it. Load it once and keep the `Borders` instance.

```ts
import { readFile } from "node:fs/promises";
import { Borders, bordersUrl, encodeWithBorders } from "mapcode-ts-borders";

const borders = Borders.fromBytes(new Uint8Array(await readFile(bordersUrl)));

borders.getTerritories(34.0522, -118.2437).map((m) => m.territory.toString());
// ["US-CA", "USA"]

borders.getCountry(34.0522, -118.2437)?.toString();
// "USA"

const { mapcodes, best, territories } = encodeWithBorders(51.4436, 4.9326, borders);
best?.getCodeWithTerritory();
// "NLD VZC.R3K"
```

Lookups take about 60 µs. `Borders` is read-only after loading, so share it between requests.

## Ranking an existing list of mapcodes

If you already have mapcodes, for example from `encodeRestrictToCountryISO`, rank them yourself.

```ts
import { encodeRestrictToCountryISO } from "mapcode-ts";
import { rankByBorders } from "mapcode-ts-borders";

const matches = borders.getTerritories(lat, lon);
const { mapcodes, best } = rankByBorders(encodeRestrictToCountryISO(lat, lon, "NLD"), matches);
```

`rankByBorders` returns a new array. Mapcodes in the most specific matching territory come first, then those in the next one, and mapcodes in territories the point is not in come last in their original order. `best` is the first mapcode in the top-ranked territory, or `null` when there is none.

## Browsers and bundlers

The package has no `node:` imports. `bordersUrl` is built with `new URL("../data/borders.mcb", import.meta.url)`, which Vite, webpack 5 and esbuild with a file loader treat as an asset reference. Fetch it and pass the bytes on.

```ts
import { Borders, bordersUrl } from "mapcode-ts-borders";

const response = await fetch(bordersUrl);
const borders = Borders.fromBytes(new Uint8Array(await response.arrayBuffer()));
```

The file is about 18 MB compressed. Serve it with gzip or brotli, and load it lazily. The package also exports the file as `mapcode-ts-borders/borders.mcb` for tools that resolve it that way.

## API

`Borders.fromBytes(bytes: Uint8Array): Borders`
Parses a `.mcb` file. Throws `BordersFormatError` for a malformed file or an alpha code that `mapcode-ts` does not know.

`borders.getTerritories(latDeg, lonDeg)` or `borders.getTerritories(point): BorderMatch[]`
All territories containing the point, ranked by admin level descending, then area ascending, then file order. Each `BorderMatch` has `territory`, `adminLevel` and `area`. Longitudes outside [-180, 180) are wrapped.

`borders.getCountry(latDeg, lonDeg)` or `borders.getCountry(point): Territory | null`
The top match, lifted to its parent when it is a subdivision. `null` when nothing matches.

`rankByBorders(mapcodes, matches): { mapcodes, best }`
Described above. Territories are compared by `toString()`.

`encodeWithBorders(latDeg, lonDeg, borders, restrictToTerritory?)` or `encodeWithBorders(point, borders, restrictToTerritory?)`
Runs `encode()`, looks up the borders and ranks. Returns `{ mapcodes, best, territories }`.

`bordersUrl: URL`
Location of the bundled `borders.mcb`.

## Regenerating the data

The `.mcb` file is generated from a FlatGeobuf file of OSM admin borders.

```
npm run gen:borders -- path/to/borders.fgb data/borders.mcb
```

Each feature needs the properties `alphaCode`, `adminLevel` and `area`, and a Polygon or MultiPolygon geometry. The script exits non-zero and lists every feature whose alpha code `mapcode-ts` does not parse back identically, or whose `parentAlphaCode` differs from the parent `mapcode-ts` knows.

## File format

Little-endian. A 32-byte header (magic `MCBD`, format version 1, and the feature, polygon, ring and vertex counts, the byte length of the codes section, and a reserved word) is followed by these sections, each starting on an 8-byte boundary: vertex coordinates (lon, lat as float64), feature areas, feature bounding boxes, and the feature-to-polygon, polygon-to-ring and ring-to-vertex offsets as uint32. After those come the admin levels as uint8 and the alpha codes as newline-separated UTF-8. The reader maps typed arrays straight onto the buffer, so loading is a copy-free parse. `src/format.ts` is the definition.

## Data attribution

The border data is derived from OpenStreetMap. Contains information from OpenStreetMap, (C) OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright). The code is licensed under Apache-2.0.
