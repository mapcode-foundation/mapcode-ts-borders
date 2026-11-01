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

import { encode, Point, type Mapcode, type Territory } from "mapcode-ts";
import type { Borders, BorderMatch } from "./borders.js";

export interface RankedMapcodes {
  readonly mapcodes: Mapcode[];
  readonly best: Mapcode | null;
}

export interface BorderedEncoding extends RankedMapcodes {
  readonly territories: BorderMatch[];
}

export function rankByBorders(mapcodes: readonly Mapcode[], matches: readonly BorderMatch[]): RankedMapcodes {
  const rank = new Map<string, number>();
  matches.forEach((m, i) => {
    // By name: territories from two installed copies of mapcode-ts are never the same object.
    const key = m.territory.toString();
    if (!rank.has(key)) rank.set(key, i);
  });
  const rankOf = (m: Mapcode): number => rank.get(m.getTerritory().toString()) ?? matches.length;

  const ranked = [...mapcodes].sort((a, b) => rankOf(a) - rankOf(b));
  const best = matches.length > 0 && ranked.length > 0 && rankOf(ranked[0]) === 0 ? ranked[0] : null;
  return { mapcodes: ranked, best };
}

// encode() checks instanceof Point, which fails for a Point from a second installed copy of mapcode-ts.
type PointLike = Pick<Point, "getLatDeg" | "getLonDeg"> & Partial<Pick<Point, "isDefined">>;

function ownPoint(point: PointLike): Point {
  if (point instanceof Point) return point;
  return point.isDefined?.() === false ? Point.undefined() : Point.fromDeg(point.getLatDeg(), point.getLonDeg());
}

export function encodeWithBorders(
  latDeg: number,
  lonDeg: number,
  borders: Borders,
  restrictToTerritory?: Territory | null,
): BorderedEncoding;
export function encodeWithBorders(
  point: Point,
  borders: Borders,
  restrictToTerritory?: Territory | null,
): BorderedEncoding;
export function encodeWithBorders(
  arg0: number | Point,
  arg1: number | Borders,
  arg2?: Borders | Territory | null,
  arg3?: Territory | null,
): BorderedEncoding {
  let territories: BorderMatch[];
  let mapcodes: Mapcode[];
  if (typeof arg0 === "number") {
    const borders = arg2 as Borders;
    territories = borders.getTerritories(arg0, arg1 as number);
    mapcodes = encode(arg0, arg1 as number, arg3 ?? null);
  } else {
    const borders = arg1 as Borders;
    territories = borders.getTerritories(arg0);
    mapcodes = encode(ownPoint(arg0), (arg2 as Territory | null | undefined) ?? null);
  }
  return { ...rankByBorders(mapcodes, territories), territories };
}
