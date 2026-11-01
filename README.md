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

`Borders.fromBytes` copies its input, so you can reuse, overwrite or release the buffer afterwards. A `Borders` instance cannot be posted to a worker thread. Load the file in each worker instead.

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

The package has no `node:` imports. `bordersUrl` is built with the standard `new URL("../data/borders.mcb", import.meta.url)` pattern. A bundler that supports this pattern copies the file as an asset. If yours does not, serve `borders.mcb` yourself and fetch it from your own URL. This has not been tested with specific bundlers yet.

```ts
import { Borders, bordersUrl } from "mapcode-ts-borders";

const response = await fetch(bordersUrl);
const borders = Borders.fromBytes(new Uint8Array(await response.arrayBuffer()));
```

The file is about 18 MB compressed. Serve it with gzip or brotli, and load it lazily. The package also exports the file as `mapcode-ts-borders/borders.mcb` for tools that resolve it that way.

## API

`Borders.fromBytes(bytes: Uint8Array): Borders`
Parses a `.mcb` file. Throws `BordersFormatError` for a malformed file, invalid metadata, or an alpha code that `mapcode-ts` does not know.

`borders.getTerritories(latDeg, lonDeg)` or `borders.getTerritories(point): BorderMatch[]`
All territories containing the point, ranked by admin level descending, then area ascending, then file order. Longitudes outside [-180, 180) are wrapped. Each `BorderMatch` has:
- `territory`, the `mapcode-ts` territory.
- `adminLevel`, the OpenStreetMap `admin_level` of the border: 2 for a country, 4 for a first-level subdivision.
- `area`, the planar area in square degrees of the simplified polygon. It only ranks overlapping borders of the same level and is not a real-world area.

`borders.getCountry(latDeg, lonDeg)` or `borders.getCountry(point): Territory | null`
The top match, lifted to its parent when it is a subdivision. `null` when nothing matches.

`borders.getSource(): BordersSource`
Where the data came from, as a frozen `{ name, snapshotDate }`. The date is ISO 8601 with month or day precision, for example `"2026-05"`.

`rankByBorders(mapcodes, matches): { mapcodes, best }`
Described above. Territories are compared by `toString()`.

`encodeWithBorders(latDeg, lonDeg, borders, restrictToTerritory?)` or `encodeWithBorders(point, borders, restrictToTerritory?)`
Runs `encode()`, looks up the borders and ranks. Returns `{ mapcodes, best, territories }`.

`bordersUrl: URL`
Location of the bundled `borders.mcb`.

## Data

The borders come from the OpenStreetMap planet. They are the boundary relations with `admin_level` 2 (countries) and 4 (first-level subdivisions). The file is built by `tools/build-borders.py` in [mapcode-foundation/mapcode-rest-service](https://github.com/mapcode-foundation/mapcode-rest-service). That script exports the relations with osmium, maps their ISO 3166 tags to mapcode alpha codes and simplifies the geometry with Douglas-Peucker. The shipped file is the `borders-100m.fgb` variant of that pipeline.

The snapshot is the May 2026 weekly planet, built on 2026-05-27. The exact planet week was not recorded, so the file says `2026-05`. `borders.getSource()` returns `{ name: "OpenStreetMap", snapshotDate: "2026-05" }`.

For the next refresh, record the planet's timestamp. osmium reads it from the PBF header. Pass it to the converter as `--snapshot-date`.

Contains information from OpenStreetMap, (C) OpenStreetMap contributors, available under the [Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright). The code is licensed under Apache-2.0.

## Regenerating the data

The `.mcb` file is generated from a FlatGeobuf file of OSM admin borders.

```
npm run gen:borders -- path/to/borders.fgb data/borders.mcb --snapshot-date 2026-05
```

`--snapshot-date` is required, as `YYYY-MM` or `YYYY-MM-DD`. `--source <name>` sets the source name and defaults to `OpenStreetMap`.

Each feature needs the properties `alphaCode`, `adminLevel` and `area`, and a Polygon or MultiPolygon geometry. The script writes nothing and exits non-zero, listing every offender, when a feature has:
- a missing, unknown or non-canonical `alphaCode`, or one that appears twice;
- a `parentAlphaCode` that differs from the parent `mapcode-ts` knows;
- an `adminLevel` that is not an integer from 0 to 255, or an `area` that is not finite;
- a missing geometry, or one that is not a Polygon or MultiPolygon;
- a coordinate that is not finite, or outside longitude [-180, 180] or latitude [-90, 90].

## File format

Little-endian. A 32-byte header holds the magic `MCBD`, format version 1, the feature, polygon, ring and vertex counts, the byte length of the codes section and the byte length of the metadata section. The sections follow, each starting on an 8-byte boundary: vertex coordinates, feature areas and bounding boxes, the offset tables, admin levels and the alpha codes. The last section is the metadata, a UTF-8 JSON object with the source name and snapshot date. The reader validates the layout, the offset tables and the metadata when it loads. `src/format.ts` is the definition.
