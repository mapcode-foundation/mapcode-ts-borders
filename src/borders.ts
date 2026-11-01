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

import { Point, Territory } from "mapcode-ts";
import { BordersFormatError, deserialize, type BorderTables } from "./format.js";

export interface BorderMatch {
  readonly territory: Territory;
  readonly adminLevel: number;
  readonly area: number;
}

export function pointInRing(
  coords: Float64Array,
  startVertex: number,
  endVertex: number,
  lon: number,
  lat: number,
): boolean {
  let inside = false;
  const n = endVertex - startVertex;
  if (n < 3) {
    return false;
  }
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xiIdx = (startVertex + i) * 2;
    const xjIdx = (startVertex + j) * 2;
    const xi = coords[xiIdx];
    const yi = coords[xiIdx + 1];
    const xj = coords[xjIdx];
    const yj = coords[xjIdx + 1];

    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

function wrapLon(lonDeg: number): number {
  if (lonDeg >= -180 && lonDeg < 180) return lonDeg;
  return ((((lonDeg + 180) % 360) + 360) % 360) - 180;
}

export class Borders {
  private constructor(
    private readonly tables: BorderTables,
    private readonly territories: readonly Territory[],
  ) {}

  static fromBytes(bytes: Uint8Array): Borders {
    const tables = deserialize(bytes);
    const territories = tables.alphaCodes.map((code) => {
      try {
        return Territory.fromString(code);
      } catch {
        throw new BordersFormatError(`Unknown territory code in borders data: ${code}`);
      }
    });
    return new Borders(tables, territories);
  }

  getTerritories(latDeg: number, lonDeg: number): BorderMatch[];
  getTerritories(point: Point): BorderMatch[];
  getTerritories(arg0: number | Point, arg1?: number): BorderMatch[] {
    const [lat, rawLon] = arg0 instanceof Point ? [arg0.getLatDeg(), arg0.getLonDeg()] : [arg0, arg1 as number];
    const lon = wrapLon(rawLon);
    const { bbox, adminLevel, area } = this.tables;
    const featureCount = this.territories.length;
    const hits: number[] = [];
    for (let f = 0; f < featureCount; f++) {
      const b = f * 4;
      if (lon < bbox[b] || lon > bbox[b + 2] || lat < bbox[b + 1] || lat > bbox[b + 3]) continue;
      if (this.featureContains(f, lon, lat)) hits.push(f);
    }
    hits.sort((a, b) => adminLevel[b] - adminLevel[a] || area[a] - area[b] || a - b);
    return hits.map((f) => ({ territory: this.territories[f], adminLevel: adminLevel[f], area: area[f] }));
  }

  getCountry(latDeg: number, lonDeg: number): Territory | null;
  getCountry(point: Point): Territory | null;
  getCountry(arg0: number | Point, arg1?: number): Territory | null {
    const matches = arg0 instanceof Point ? this.getTerritories(arg0) : this.getTerritories(arg0, arg1 as number);
    if (matches.length === 0) return null;
    const top = matches[0].territory;
    return top.getParentTerritory() ?? top;
  }

  private featureContains(feature: number, lon: number, lat: number): boolean {
    const { featurePolyStart, polyRingStart, ringOffsets, coords } = this.tables;
    for (let p = featurePolyStart[feature]; p < featurePolyStart[feature + 1]; p++) {
      const ringStart = polyRingStart[p];
      const ringEnd = polyRingStart[p + 1];
      if (ringStart >= ringEnd) continue;
      if (!pointInRing(coords, ringOffsets[ringStart], ringOffsets[ringStart + 1], lon, lat)) continue;
      let inHole = false;
      for (let r = ringStart + 1; r < ringEnd; r++) {
        if (pointInRing(coords, ringOffsets[r], ringOffsets[r + 1], lon, lat)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }
}
