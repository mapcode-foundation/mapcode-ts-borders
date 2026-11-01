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
    const key = m.territory.toString();
    if (!rank.has(key)) rank.set(key, i);
  });
  const rankOf = (m: Mapcode): number => rank.get(m.getTerritory().toString()) ?? Infinity;

  const ranked = mapcodes
    .map((mapcode, i) => ({ mapcode, i, r: rankOf(mapcode) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? -1 : 1))
    .map((e) => e.mapcode);

  const top = matches.length === 0 ? null : matches[0].territory.toString();
  const best = top === null ? null : ranked.find((m) => m.getTerritory().toString() === top) ?? null;
  return { mapcodes: ranked, best };
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
  let latDeg: number;
  let lonDeg: number;
  let borders: Borders;
  let restrict: Territory | null;
  if (arg0 instanceof Point) {
    latDeg = arg0.getLatDeg();
    lonDeg = arg0.getLonDeg();
    borders = arg1 as Borders;
    restrict = (arg2 as Territory | null | undefined) ?? null;
  } else {
    latDeg = arg0;
    lonDeg = arg1 as number;
    borders = arg2 as Borders;
    restrict = arg3 ?? null;
  }
  const territories = borders.getTerritories(latDeg, lonDeg);
  const ranked = rankByBorders(encode(latDeg, lonDeg, restrict), territories);
  return { ...ranked, territories };
}
