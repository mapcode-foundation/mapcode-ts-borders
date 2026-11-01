// Copyright (C) 2026, Stichting Mapcode Foundation (http://www.mapcode.com)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { geojson } from "flatgeobuf";
import { parseAlphaCode } from "../src/alpha-code.ts";
import { buildTables, serialize, SNAPSHOT_DATE_PATTERN, type BorderFeature } from "../src/format.ts";

// flatgeobuf's IGeoJsonFeature is not exported and its GeoJSON types are not installed.
interface GeoJsonFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

const usage = "Usage: convert-borders.mts <in.fgb> <out.mcb> --snapshot-date <YYYY-MM[-DD]> [--source <name>]";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "snapshot-date": { type: "string" },
    source: { type: "string", default: "OpenStreetMap" },
  },
});
const [inPath, outPath] = positionals;
const snapshotDate = values["snapshot-date"];
if (!inPath || !outPath || positionals.length > 2) {
  console.error(usage);
  process.exit(2);
}
if (snapshotDate === undefined || !SNAPSHOT_DATE_PATTERN.test(snapshotDate)) {
  console.error(`--snapshot-date must be an ISO 8601 date, YYYY-MM or YYYY-MM-DD\n${usage}`);
  process.exit(2);
}

const input = readFileSync(inPath);
const features: BorderFeature[] = [];
const offenders: string[] = [];
const seen = new Set<string>();

function checkCoordinates(label: string, polygons: number[][][][]): void {
  let nonFinite = false;
  let outOfRange = false;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const position of ring) {
        const [lon, lat] = position;
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
          if (!nonFinite) offenders.push(`${label}: non-finite coordinate [${position}]`);
          nonFinite = true;
        } else if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          if (!outOfRange) offenders.push(`${label}: coordinate out of range [${position}]`);
          outOfRange = true;
        }
      }
    }
  }
}

let index = 0;
for await (const raw of geojson.deserialize(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))) {
  const feature = raw as unknown as GeoJsonFeature;
  index++;
  const { alphaCode, adminLevel, area, parentAlphaCode } = feature.properties ?? {};
  if (typeof alphaCode !== "string" || alphaCode.length === 0) {
    offenders.push(`feature #${index}: missing or invalid alphaCode`);
    continue;
  }
  const label = `${alphaCode} (feature #${index})`;
  const territory = parseAlphaCode(alphaCode);
  if (territory === null) {
    offenders.push(`${label}: unknown or non-canonical alpha code`);
  } else {
    const expectedParent = territory.getParentTerritory()?.toString() ?? null;
    const fileParent = typeof parentAlphaCode === "string" && parentAlphaCode.length > 0 ? parentAlphaCode : null;
    if (fileParent !== expectedParent) {
      offenders.push(`${label}: parent is ${fileParent} in the file, ${expectedParent} in mapcode-ts`);
    }
  }
  if (seen.has(alphaCode)) {
    offenders.push(`${label}: duplicate alphaCode`);
  }
  seen.add(alphaCode);
  if (typeof adminLevel !== "number" || !Number.isInteger(adminLevel) || adminLevel < 0 || adminLevel > 255) {
    offenders.push(`${label}: adminLevel is not an integer in 0..255: ${adminLevel}`);
  }
  if (typeof area !== "number" || !Number.isFinite(area)) {
    offenders.push(`${label}: area is not a finite number: ${area}`);
  }

  const geometry = feature.geometry;
  let polygons: number[][][][];
  if (geometry?.type === "Polygon") {
    polygons = [geometry.coordinates as number[][][]];
  } else if (geometry?.type === "MultiPolygon") {
    polygons = geometry.coordinates as number[][][][];
  } else {
    offenders.push(`${label}: geometry is ${geometry?.type ?? "missing"}, not Polygon or MultiPolygon`);
    continue;
  }
  checkCoordinates(label, polygons);

  features.push({ alphaCode, adminLevel: adminLevel as number, area: area as number, polygons });
}

if (offenders.length > 0) {
  console.error(`${offenders.length} problem(s) in ${inPath}:`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

const tables = buildTables(features, { name: values.source, snapshotDate });
const bytes = serialize(tables);
writeFileSync(outPath, bytes);
console.log(`Wrote ${outPath}: ${tables.alphaCodes.length} features, ${tables.coords.length / 2} vertices, ${bytes.length} bytes`);
