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

import { readFile } from "node:fs/promises";
import { encode } from "mapcode-ts";
import { beforeAll, describe, expect, it } from "vitest";
import { Borders, bordersUrl, encodeWithBorders } from "../src/index.js";

let borders: Borders;

beforeAll(async () => {
  borders = Borders.fromBytes(new Uint8Array(await readFile(bordersUrl)));
});

const cases: {
  name: string;
  lat: number;
  lon: number;
  territories: string[];
  best: string | null;
  ranked?: string[];
}[] = [
  { name: "Amsterdam", lat: 52.376514, lon: 4.908543, territories: ["NLD"], best: "NLD 49.4V" },
  { name: "Baarle-Hertog", lat: 51.4398, lon: 4.9298, territories: ["BEL"], best: "BEL 4W5.BVN" },
  {
    name: "Baarle-Nassau", lat: 51.4436, lon: 4.9326, territories: ["NLD"], best: "NLD VZC.R3K",
    ranked: ["NLD VZC.R3K", "NLD P56B.ZD9", "BEL 4W4.ZPQ", "BEL P56B.ZD9", "AAA VHXLS.GZ16"],
  },
  {
    name: "Strasbourg", lat: 48.5734, lon: 7.8013, territories: ["FRA"], best: "FRA 8XK.RN",
    ranked: ["FRA 8XK.RN", "FRA 5K.RDHV", "FRA WD7M.13W", "DEU 4RMW.QKW", "AAA VJ5G4.53LZ"],
  },
  { name: "Los Angeles", lat: 34.0522, lon: -118.2437, territories: ["US-CA", "USA"], best: "US-CA MF.0M" },
  { name: "North Sea", lat: 54.0, lon: 3.0, territories: [], best: null },
];

describe("real border data", () => {
  it.each(cases)("$name", ({ lat, lon, territories, best, ranked }) => {
    expect(borders.getTerritories(lat, lon).map((m) => m.territory.toString())).toEqual(territories);

    const result = encodeWithBorders(lat, lon, borders);
    expect(result.best?.getCodeWithTerritory() ?? null).toBe(best);
    const labels = result.mapcodes.map((m) => m.getCodeWithTerritory());
    expect(labels).toEqual(ranked ?? encode(lat, lon).map((m) => m.getCodeWithTerritory()));
  });

  it("lifts Los Angeles to its country", () => {
    expect(borders.getCountry(34.0522, -118.2437)?.toString()).toBe("USA");
  });

  it("finds no country at sea", () => {
    expect(borders.getCountry(54, 3)).toBeNull();
  });
});
