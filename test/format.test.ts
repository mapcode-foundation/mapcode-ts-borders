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
import {
  BordersFormatError,
  buildTables,
  deserialize,
  serialize,
  type BorderFeature,
  type BorderTables,
} from "../src/format.js";

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

  it("does not alias the caller's buffer", () => {
    const good = bytes();
    const tables = deserialize(good);
    good.fill(0);
    expect(tables).toEqual(buildTables(features, source));
  });

  it("rejects counts whose layout does not fit the input, without a RangeError", () => {
    for (const offset of [8, 12, 16, 20, 24, 28]) {
      const bad = bytes();
      new DataView(bad.buffer).setUint32(offset, 0xffffffff, true);
      expect(() => deserialize(bad)).toThrow(BordersFormatError);
    }
  });

  describe("offset tables", () => {
    const withTables = (change: (t: BorderTables) => void): Uint8Array => {
      const tables = buildTables(features, source);
      change(tables);
      return serialize(tables);
    };

    it.each<[string, (t: BorderTables) => void, RegExp]>([
      ["a feature table that does not start at 0", (t) => { t.featurePolyStart[0] = 1; }, /Feature-to-polygon.*start/],
      ["a decreasing feature table", (t) => { t.featurePolyStart[1] = 0; t.featurePolyStart[2] = 3; t.featurePolyStart[3] = 2; }, /Feature-to-polygon.*decreases/],
      ["a feature table that ends early", (t) => { t.featurePolyStart[3] = 3; }, /Feature-to-polygon.*ends/],
      ["a polygon table that does not start at 0", (t) => { t.polyRingStart[0] = 1; }, /Polygon-to-ring.*start/],
      ["a decreasing polygon table", (t) => { t.polyRingStart[2] = 0; }, /Polygon-to-ring.*decreases/],
      ["a polygon table that ends past the ring count", (t) => { t.polyRingStart[4] = 99; }, /Polygon-to-ring.*ends/],
      ["a ring table that does not start at 0", (t) => { t.ringOffsets[0] = 1; }, /Ring-to-vertex.*start/],
      ["a decreasing ring table", (t) => { t.ringOffsets[2] = 0; }, /Ring-to-vertex.*decreases/],
      ["a ring table that ends past the vertex count", (t) => { t.ringOffsets[5] = 1_000_000; }, /Ring-to-vertex.*ends/],
    ])("rejects %s", (_name, change, message) => {
      expect(() => deserialize(withTables(change))).toThrow(BordersFormatError);
      expect(() => deserialize(withTables(change))).toThrow(message);
    });
  });

  describe("metadata", () => {
    const withMeta = (text: string): Uint8Array => {
      const good = bytes();
      const view = new DataView(good.buffer);
      const kept = good.subarray(0, good.length - view.getUint32(28, true));
      const meta = new TextEncoder().encode(text);
      const out = new Uint8Array(kept.length + meta.length);
      out.set(kept);
      out.set(meta, kept.length);
      new DataView(out.buffer).setUint32(28, meta.length, true);
      return out;
    };

    it("reads the source back", () => {
      expect(deserialize(bytes()).source).toEqual(source);
    });

    it("accepts a day-precision snapshot date", () => {
      const tables = deserialize(withMeta('{"source":"OpenStreetMap","snapshotDate":"2026-05-27"}'));
      expect(tables.source).toEqual({ name: "OpenStreetMap", snapshotDate: "2026-05-27" });
    });

    it.each([
      ["not JSON", "not json"],
      ["empty", ""],
      ["a JSON array", "[]"],
      ["a missing source", '{"snapshotDate":"2026-05"}'],
      ["an empty source", '{"source":"","snapshotDate":"2026-05"}'],
      ["a missing snapshot date", '{"source":"OpenStreetMap"}'],
      ["a numeric snapshot date", '{"source":"OpenStreetMap","snapshotDate":202605}'],
      ["a snapshot date that is not ISO 8601", '{"source":"OpenStreetMap","snapshotDate":"May 2026"}'],
      ["month 13", '{"source":"OpenStreetMap","snapshotDate":"2026-13"}'],
      ["day 32", '{"source":"OpenStreetMap","snapshotDate":"2026-05-32"}'],
    ])("rejects %s", (_name, text) => {
      expect(() => deserialize(withMeta(text))).toThrow(BordersFormatError);
    });

    it("refuses to build with an invalid source", () => {
      expect(() => buildTables(features, { name: "", snapshotDate: "2026-05" })).toThrow(BordersFormatError);
      expect(() => buildTables(features, { name: "OpenStreetMap", snapshotDate: "2026" })).toThrow(BordersFormatError);
    });
  });

  it.each([256, -1, 2.5, Number.NaN])("refuses to build with admin level %d", (adminLevel) => {
    const feature = { alphaCode: "NLD", adminLevel, area: 1, polygons: [[square(0, 0, 1)]] };
    expect(() => buildTables([feature], source)).toThrow(BordersFormatError);
  });

  it("refuses to build with a newline in an alpha code", () => {
    const feature = { alphaCode: "NLD\nBEL", adminLevel: 2, area: 1, polygons: [[square(0, 0, 1)]] };
    expect(() => buildTables([feature], source)).toThrow(/newline/);
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
