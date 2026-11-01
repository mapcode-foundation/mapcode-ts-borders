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
import { geojson } from "flatgeobuf";
import { Territory } from "mapcode-ts";
import { buildTables, serialize, type BorderFeature } from "../src/format.ts";

interface GeoJsonFeature {
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("Usage: convert-borders.mts <in.fgb> <out.mcb>");
  process.exit(2);
}

const input = readFileSync(inPath);
const features: BorderFeature[] = [];
const offenders: string[] = [];

for await (const raw of geojson.deserialize(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))) {
  const feature = raw as unknown as GeoJsonFeature;
  const geometry = feature.geometry;
  const props = feature.properties ?? {};
  const { alphaCode, adminLevel, area, parentAlphaCode } = props;
  if (!geometry || typeof alphaCode !== "string" || alphaCode.length === 0) continue;
  if (typeof adminLevel !== "number" || !Number.isFinite(adminLevel)) continue;
  if (typeof area !== "number" || !Number.isFinite(area)) continue;
  let polygons: number[][][][];
  if (geometry.type === "Polygon") {
    polygons = [geometry.coordinates as number[][][]];
  } else if (geometry.type === "MultiPolygon") {
    polygons = geometry.coordinates as number[][][][];
  } else {
    continue;
  }

  try {
    const territory = Territory.fromString(alphaCode);
    if (territory.toString() !== alphaCode) {
      offenders.push(`${alphaCode}: parses as ${territory.toString()}`);
    }
    const expectedParent = territory.getParentTerritory()?.toString() ?? null;
    const fileParent = typeof parentAlphaCode === "string" && parentAlphaCode.length > 0 ? parentAlphaCode : null;
    if (fileParent !== expectedParent) {
      offenders.push(`${alphaCode}: parent is ${fileParent} in the file, ${expectedParent} in mapcode-ts`);
    }
  } catch {
    offenders.push(`${alphaCode}: unknown territory`);
  }

  features.push({ alphaCode, adminLevel: Math.trunc(adminLevel), area, polygons });
}

if (offenders.length > 0) {
  console.error(`${offenders.length} feature(s) do not match mapcode-ts:`);
  for (const line of offenders) console.error(`  ${line}`);
  process.exit(1);
}

const tables = buildTables(features);
const bytes = serialize(tables);
writeFileSync(outPath, bytes);
console.log(`Wrote ${outPath}: ${tables.alphaCodes.length} features, ${tables.coords.length / 2} vertices, ${bytes.length} bytes`);
