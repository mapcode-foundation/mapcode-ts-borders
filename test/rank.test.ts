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

import { type Mapcode, Point, Territory, encode } from "mapcode-ts";
import { describe, expect, it } from "vitest";
import { Borders, encodeWithBorders, rankByBorders, type BorderMatch } from "../src/index.js";
import { buildTables, serialize } from "../src/format.js";

const match = (code: string, adminLevel = 2, area = 1): BorderMatch => ({
  territory: Territory.fromString(code),
  adminLevel,
  area,
});


const baarle = encode(51.4436, 4.9326);
const labels = (list: readonly Mapcode[]): string[] => list.map((m) => m.getCodeWithTerritory());

describe("rankByBorders", () => {
  it("orders mapcodes by the rank of their territory", () => {
    const { mapcodes } = rankByBorders(baarle, [match("BEL"), match("NLD")]);
    expect(labels(mapcodes).slice(0, 2).map((s) => s.slice(0, 3))).toEqual(["BEL", "BEL"]);
  });

  it("is stable and puts unmatched territories last", () => {
    const original = labels(baarle);
    const { mapcodes } = rankByBorders(baarle, [match("NLD")]);
    const expected = [
      ...original.filter((s) => s.startsWith("NLD")),
      ...original.filter((s) => !s.startsWith("NLD")),
    ];
    expect(labels(mapcodes)).toEqual(expected);
  });

  it("returns the input order when there are no matches", () => {
    const result = rankByBorders(baarle, []);
    expect(labels(result.mapcodes)).toEqual(labels(baarle));
    expect(result.best).toBeNull();
  });

  it("picks the first mapcode of the top territory as best", () => {
    const { best } = rankByBorders(baarle, [match("BEL"), match("NLD")]);
    expect(best?.getTerritory().toString()).toBe("BEL");
    expect(best?.getCodeWithTerritory()).toBe(labels(baarle).find((s) => s.startsWith("BEL")));
  });

  it("has no best when no mapcode is in the top territory", () => {
    expect(rankByBorders(baarle, [match("FRA")]).best).toBeNull();
  });

  it("does not mutate its input", () => {
    const before = labels(baarle);
    const input = [...baarle];
    const result = rankByBorders(input, [match("BEL")]);
    expect(labels(input)).toEqual(before);
    expect(result.mapcodes).not.toBe(input);
  });

  it("compares territories by name, not identity", () => {
    const lookalike = { toString: () => "BEL" } as unknown as Territory;
    const { best } = rankByBorders(baarle, [{ territory: lookalike, adminLevel: 2, area: 1 }]);
    expect(best?.getTerritory().toString()).toBe("BEL");
  });
});

describe("encodeWithBorders", () => {
  const box = [[4, 51], [6, 51], [6, 52], [4, 52], [4, 51]];
  const borders = Borders.fromBytes(serialize(buildTables([
    { alphaCode: "NLD", adminLevel: 2, area: 10, polygons: [[box]] },
  ])));

  it("ranks the encoding by the borders and returns the matches", () => {
    const result = encodeWithBorders(51.4436, 4.9326, borders);
    expect(result.territories.map((m) => m.territory.toString())).toEqual(["NLD"]);
    expect(result.best?.getTerritory().toString()).toBe("NLD");
    expect(labels(result.mapcodes)[0].startsWith("NLD")).toBe(true);
  });

  it("accepts a Point and a territory restriction", () => {
    const point = Point.fromDeg(51.4436, 4.9326);
    const restricted = encodeWithBorders(point, borders, Territory.fromString("BEL"));
    expect(restricted.mapcodes.every((m) => m.getTerritory().toString() === "BEL")).toBe(true);
    expect(restricted.best).toBeNull();
    expect(labels(encodeWithBorders(point, borders).mapcodes)).toEqual(
      labels(encodeWithBorders(51.4436, 4.9326, borders).mapcodes),
    );
  });

  it("has no best outside every border", () => {
    const result = encodeWithBorders(54, 3, borders);
    expect(result.territories).toEqual([]);
    expect(result.best).toBeNull();
    expect(labels(result.mapcodes)).toEqual(labels(encode(54, 3)));
  });
});
