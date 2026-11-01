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

import { Point } from "mapcode-ts";
import { describe, expect, it } from "vitest";
import { Borders, BordersFormatError } from "../src/index.js";
import { pointInRing } from "../src/borders.js";
import { buildTables, serialize, type BorderFeature } from "../src/format.js";

const box = (west: number, south: number, east: number, north: number): number[][] => [
  [west, south], [east, south], [east, north], [west, north], [west, south],
];

const make = (features: BorderFeature[]): Borders => Borders.fromBytes(serialize(buildTables(features)));
const codes = (b: Borders, lat: number, lon: number): string[] =>
  b.getTerritories(lat, lon).map((m) => m.territory.toString());

const fixture = make([
  { alphaCode: "NLD", adminLevel: 2, area: 100, polygons: [[box(0, 50, 10, 60)]] },
  { alphaCode: "USA", adminLevel: 2, area: 1000, polygons: [[box(-130, 30, -100, 50)]] },
  { alphaCode: "US-CA", adminLevel: 4, area: 100, polygons: [[box(-125, 32, -115, 42)]] },
  { alphaCode: "IND", adminLevel: 2, area: 500, polygons: [[box(100, 0, 110, 10)]] },
  { alphaCode: "VNM", adminLevel: 2, area: 20, polygons: [[box(105, 5, 108, 8)]] },
  { alphaCode: "BEL", adminLevel: 2, area: 50, polygons: [[box(20, 0, 40, 20), box(25, 5, 35, 15)]] },
  { alphaCode: "DEU", adminLevel: 2, area: 60, polygons: [[box(60, 0, 70, 10)], [box(80, 0, 90, 10)]] },
]);

describe("pointInRing", () => {
  const square = new Float64Array([0, 0, 10, 0, 10, 10, 0, 10, 0, 0]);

  it("tells inside from outside", () => {
    expect(pointInRing(square, 0, 5, 5, 5)).toBe(true);
    expect(pointInRing(square, 0, 5, 15, 5)).toBe(false);
    expect(pointInRing(square, 0, 5, -1, 5)).toBe(false);
  });

  it("rejects a ring with fewer than 3 vertices", () => {
    expect(pointInRing(new Float64Array([0, 0, 1, 1]), 0, 2, 0, 0)).toBe(false);
  });
});

describe("Borders.getTerritories", () => {
  it("returns the country for a point inside it", () => {
    const matches = fixture.getTerritories(55, 5);
    expect(matches.map((m) => m.territory.toString())).toEqual(["NLD"]);
    expect(matches[0].adminLevel).toBe(2);
    expect(matches[0].area).toBe(100);
  });

  it("returns nothing for a point outside every feature", () => {
    expect(codes(fixture, 0, -30)).toEqual([]);
    expect(codes(fixture, 70, 5)).toEqual([]);
  });

  it("puts the subdivision before its country", () => {
    const matches = fixture.getTerritories(36, -120);
    expect(matches.map((m) => m.territory.toString())).toEqual(["US-CA", "USA"]);
    expect(matches.map((m) => m.adminLevel)).toEqual([4, 2]);
  });

  it("puts the smaller area first for overlapping features of the same level", () => {
    expect(codes(fixture, 6.5, 106.5)).toEqual(["VNM", "IND"]);
  });

  it("keeps feature order for equal level and area", () => {
    const tied = make([
      { alphaCode: "FRA", adminLevel: 2, area: 5, polygons: [[box(0, 0, 10, 10)]] },
      { alphaCode: "ESP", adminLevel: 2, area: 5, polygons: [[box(0, 0, 10, 10)]] },
    ]);
    expect(codes(tied, 5, 5)).toEqual(["FRA", "ESP"]);
  });

  it("excludes a point inside a hole", () => {
    expect(codes(fixture, 10, 30)).toEqual([]);
    expect(codes(fixture, 2, 22)).toEqual(["BEL"]);
  });

  it("matches any polygon of a multipolygon", () => {
    expect(codes(fixture, 5, 65)).toEqual(["DEU"]);
    expect(codes(fixture, 5, 85)).toEqual(["DEU"]);
    expect(codes(fixture, 5, 75)).toEqual([]);
  });

  it("skips a degenerate feature before a valid one without spurious matches", () => {
    const b = make([
      { alphaCode: "FRA", adminLevel: 2, area: 1, polygons: [[[]], [[]]] },
      { alphaCode: "ESP", adminLevel: 2, area: 100, polygons: [[box(0, 0, 10, 10)]] },
    ]);
    expect(codes(b, 5, 5)).toEqual(["ESP"]);
    expect(codes(b, 50, 50)).toEqual([]);
  });

  it("treats longitude 360 + x like x", () => {
    expect(codes(fixture, 55, 365)).toEqual(["NLD"]);
    expect(codes(fixture, 36, -120 + 360)).toEqual(["US-CA", "USA"]);
    expect(codes(fixture, 36, 240)).toEqual(["US-CA", "USA"]);
    expect(codes(fixture, 55, -355)).toEqual(["NLD"]);
  });

  it("accepts a Point", () => {
    const matches = fixture.getTerritories(Point.fromDeg(36, -120));
    expect(matches.map((m) => m.territory.toString())).toEqual(["US-CA", "USA"]);
  });
});

describe("Borders.getCountry", () => {
  it("lifts a subdivision to its country", () => {
    expect(fixture.getCountry(36, -120)?.toString()).toBe("USA");
  });

  it("returns a country as is", () => {
    expect(fixture.getCountry(55, 5)?.toString()).toBe("NLD");
  });

  it("returns null at sea", () => {
    expect(fixture.getCountry(0, -30)).toBeNull();
  });

  it("accepts a Point", () => {
    expect(fixture.getCountry(Point.fromDeg(36, -120))?.toString()).toBe("USA");
  });
});

describe("Borders.fromBytes", () => {
  it("rejects an unknown territory code, naming it", () => {
    const bytes = serialize(buildTables([
      { alphaCode: "QQQ-ZZ", adminLevel: 2, area: 1, polygons: [[box(0, 0, 1, 1)]] },
    ]));
    expect(() => Borders.fromBytes(bytes)).toThrow(BordersFormatError);
    expect(() => Borders.fromBytes(bytes)).toThrow(/QQQ-ZZ/);
  });

  it("rejects malformed bytes", () => {
    expect(() => Borders.fromBytes(new Uint8Array(40))).toThrow(BordersFormatError);
  });
});
