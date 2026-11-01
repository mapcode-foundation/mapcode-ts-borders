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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geojson } from "flatgeobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Borders } from "../src/index.js";

type Props = Record<string, unknown>;
interface TestFeature {
  properties: Props;
  geometry: { type: string; coordinates: unknown } | null;
}

const script = join(import.meta.dirname, "..", "scripts", "convert-borders.mts");

const ring = (west: number, south: number, east: number, north: number): number[][] => [
  [west, south], [east, south], [east, north], [west, north], [west, south],
];

const feature = (props: Props = {}, geometry: TestFeature["geometry"] = null): TestFeature => ({
  properties: { alphaCode: "NLD", adminLevel: 2, area: 100, parentAlphaCode: "", ...props },
  geometry: geometry ?? { type: "Polygon", coordinates: [ring(0, 50, 10, 60)] },
});

let dir: string;
let counter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "convert-borders-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function convert(features: TestFeature[], args: string[] = ["--snapshot-date", "2026-05"]) {
  const id = counter++;
  const input = join(dir, `${id}.fgb`);
  const output = join(dir, `${id}.mcb`);
  const collection = { type: "FeatureCollection", features: features.map((f) => ({ type: "Feature", ...f })) };
  writeFileSync(input, geojson.serialize(collection as Parameters<typeof geojson.serialize>[0]));
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", script, input, output, ...args], {
      stdio: "pipe",
    });
    return { status: 0, stderr: "", output };
  } catch (error) {
    const failure = error as { status: number; stderr: Buffer };
    return { status: failure.status, stderr: failure.stderr.toString(), output };
  }
}

describe("convert-borders", () => {
  it("writes a loadable file that records its source", () => {
    const result = convert([
      feature(),
      feature({ alphaCode: "US-CA", adminLevel: 4, parentAlphaCode: "USA" }, {
        type: "MultiPolygon",
        coordinates: [[ring(-125, 32, -115, 42)], [ring(-110, 32, -105, 42)]],
      }),
    ]);
    expect(result.status).toBe(0);
    const borders = Borders.fromBytes(readFileSync(result.output));
    expect(borders.getSource()).toEqual({ name: "OpenStreetMap", snapshotDate: "2026-05" });
    expect(borders.getTerritories(55, 5).map((m) => m.territory.toString())).toEqual(["NLD"]);
    expect(borders.getTerritories(35, -107).map((m) => m.territory.toString())).toEqual(["US-CA"]);
  });

  it("records a custom source and a day-precision date", () => {
    const result = convert([feature()], ["--snapshot-date", "2026-05-27", "--source", "Test Source"]);
    expect(result.status).toBe(0);
    expect(Borders.fromBytes(readFileSync(result.output)).getSource()).toEqual({
      name: "Test Source",
      snapshotDate: "2026-05-27",
    });
  });

  it.each<[string, TestFeature[], RegExp]>([
    ["an empty alphaCode", [feature({ alphaCode: "" })], /feature #1.*alphaCode/],
    ["an unknown alphaCode", [feature({ alphaCode: "QQQ-ZZ" })], /QQQ-ZZ.*unknown/],
    ["a non-canonical alphaCode", [feature({ alphaCode: "nld" })], /nld.*non-canonical/],
    ["a duplicate alphaCode", [feature(), feature()], /NLD.*duplicate/],
    ["a parent mismatch", [feature({ alphaCode: "US-CA", adminLevel: 4, parentAlphaCode: "CAN" })], /US-CA.*parent/],
    ["a fractional adminLevel", [feature({ adminLevel: 2.5 })], /NLD.*adminLevel/],
    ["an adminLevel above 255", [feature({ adminLevel: 256 })], /NLD.*adminLevel/],
    ["a negative adminLevel", [feature({ adminLevel: -1 })], /NLD.*adminLevel/],
    ["a non-finite area", [feature({ area: Number.NaN })], /NLD.*area/],
    ["a Point geometry", [feature({}, { type: "Point", coordinates: [5, 55] })], /NLD.*Point/],
    ["a longitude above 180", [feature({}, { type: "Polygon", coordinates: [ring(0, 50, 181, 60)] })], /NLD.*out of range/],
    ["a latitude below -90", [feature({}, { type: "Polygon", coordinates: [ring(0, -91, 10, 60)] })], /NLD.*out of range/],
    [
      "a non-finite coordinate",
      [feature({}, { type: "Polygon", coordinates: [[[0, 50], [Number.NaN, 50], [10, 60], [0, 50]]] })],
      /NLD.*non-finite/,
    ],
  ])("exits non-zero for %s and names the offender", (_name, features, message) => {
    const result = convert(features);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
  });

  it("lists every offender, not just the first", () => {
    const result = convert([feature({ alphaCode: "QQQ-ZZ" }), feature({ adminLevel: 256 })]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/QQQ-ZZ/);
    expect(result.stderr).toMatch(/adminLevel/);
  });

  it.each<[string, string[]]>([
    ["missing", []],
    ["not a date", ["--snapshot-date", "May 2026"]],
    ["an invalid month", ["--snapshot-date", "2026-13"]],
    ["an invalid day", ["--snapshot-date", "2026-05-32"]],
  ])("exits non-zero when --snapshot-date is %s", (_name, args) => {
    const result = convert([feature()], args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/snapshot-date/);
  });
});
