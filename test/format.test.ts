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

import { describe, expect, it } from "vitest";
import { BordersFormatError, buildTables, deserialize, serialize, type BorderFeature } from "../src/format.js";

const source = { name: "OpenStreetMap", snapshotDate: "2026-05" };

const square = (x: number, y: number, size: number): number[][] => [
  [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
];

const features: BorderFeature[] = [
  { alphaCode: "NLD", adminLevel: 2, area: 100, polygons: [[square(0, 0, 10)]] },
  { alphaCode: "US-CA", adminLevel: 4, area: 4.5, polygons: [[square(20, 20, 10), square(22, 22, 2)], [square(40, 40, 1)]] },
  { alphaCode: "BEL", adminLevel: 2, area: 7, polygons: [[square(50, 50, 3)]] },
];

const bytes = (): Uint8Array => serialize(buildTables(features, source));

describe("borders format", () => {
  it("round trips every table", () => {
    const original = buildTables(features, source);
    const copy = deserialize(serialize(original));
    expect(copy).toEqual(original);
    expect(copy.alphaCodes.length).toBe(3);
    expect(copy.polyRingStart.length - 1).toBe(4);
    expect(copy.ringOffsets.length - 1).toBe(5);
  });

  it("reads input at a misaligned byte offset", () => {
    const good = bytes();
    const backing = new Uint8Array(good.length + 1);
    backing.set(good, 1);
    const misaligned = backing.subarray(1);
    expect(misaligned.byteOffset % 8).toBe(1);
    expect(deserialize(misaligned)).toEqual(buildTables(features, source));
  });

  it("reads a view into a larger aligned buffer", () => {
    const good = bytes();
    const backing = new Uint8Array(good.length + 16);
    backing.set(good, 8);
    expect(deserialize(backing.subarray(8, 8 + good.length))).toEqual(buildTables(features, source));
  });

  it("rejects bad magic", () => {
    const bad = bytes();
    bad[0] = 0x58;
    expect(() => deserialize(bad)).toThrow(BordersFormatError);
    expect(() => deserialize(bad)).toThrow(/magic/);
  });

  it("rejects an unknown version", () => {
    const bad = bytes();
    new DataView(bad.buffer).setUint32(4, 2, true);
    expect(() => deserialize(bad)).toThrow(/version 2/);
  });

  it("rejects truncated and extended data", () => {
    const good = bytes();
    expect(() => deserialize(good.subarray(0, good.length - 1))).toThrow(BordersFormatError);
    expect(() => deserialize(good.subarray(0, 10))).toThrow(BordersFormatError);
    const longer = new Uint8Array(good.length + 1);
    longer.set(good);
    expect(() => deserialize(longer)).toThrow(BordersFormatError);
  });

  it("rejects a code count that does not match the feature count", () => {
    const tables = buildTables(features.slice(0, 2), source);
    const bad = serialize({ ...tables, alphaCodes: ["NLD", "US-CA\nBEL"] });
    expect(() => deserialize(bad)).toThrow(/3 alpha codes for 2 features/);
  });

  it("skips features and polygons without vertices", () => {
    const tables = buildTables([
      { alphaCode: "BAD", adminLevel: 2, area: 1, polygons: [[[]], [[]]] },
      { alphaCode: "NLD", adminLevel: 2, area: 100, polygons: [[[]], [square(0, 0, 10)]] },
    ], source);
    expect(tables.alphaCodes).toEqual(["NLD"]);
    expect(tables.polyRingStart.length - 1).toBe(1);
    expect(tables.ringOffsets.length - 1).toBe(1);
  });

  it("refuses to build from no usable feature", () => {
    expect(() => buildTables([], source)).toThrow(BordersFormatError);
    expect(() => buildTables([{ alphaCode: "BAD", adminLevel: 2, area: 1, polygons: [[[]]] }], source)).toThrow(BordersFormatError);
  });
});
