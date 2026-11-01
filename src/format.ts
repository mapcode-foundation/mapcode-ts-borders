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

export interface BorderFeature {
  alphaCode: string;
  adminLevel: number;
  area: number;
  polygons: number[][][][];
}

export interface BorderTables {
  coords: Float64Array;
  area: Float64Array;
  bbox: Float64Array;
  featurePolyStart: Uint32Array;
  polyRingStart: Uint32Array;
  ringOffsets: Uint32Array;
  adminLevel: Uint8Array;
  alphaCodes: string[];
}

export class BordersFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BordersFormatError";
  }
}

const MAGIC = [0x4d, 0x43, 0x42, 0x44];
const FORMAT_VERSION = 1;
const HEADER_BYTES = 32;

interface Counts {
  featureCount: number;
  polygonCount: number;
  ringCount: number;
  vertexCount: number;
  codesByteLength: number;
}

interface Layout {
  coords: number;
  area: number;
  bbox: number;
  featurePolyStart: number;
  polyRingStart: number;
  ringOffsets: number;
  adminLevel: number;
  codes: number;
  total: number;
}

const align8 = (n: number): number => Math.ceil(n / 8) * 8;

function layout(c: Counts): Layout {
  const coords = HEADER_BYTES;
  const area = align8(coords + c.vertexCount * 16);
  const bbox = align8(area + c.featureCount * 8);
  const featurePolyStart = align8(bbox + c.featureCount * 32);
  const polyRingStart = align8(featurePolyStart + (c.featureCount + 1) * 4);
  const ringOffsets = align8(polyRingStart + (c.polygonCount + 1) * 4);
  const adminLevel = align8(ringOffsets + (c.ringCount + 1) * 4);
  const codes = align8(adminLevel + c.featureCount);
  return {
    coords, area, bbox, featurePolyStart, polyRingStart, ringOffsets, adminLevel, codes,
    total: codes + c.codesByteLength,
  };
}

function isLittleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

export function buildTables(features: readonly BorderFeature[]): BorderTables {
  const coords: number[] = [];
  const ringOffsets: number[] = [0];
  const polyRingStart: number[] = [0];
  const featurePolyStart: number[] = [0];
  const alphaCodes: string[] = [];
  const adminLevel: number[] = [];
  const area: number[] = [];
  const bbox: number[] = [];

  for (const feature of features) {
    const polygons = feature.polygons.filter((polygon) => polygon.length > 0 && polygon[0].length > 0);
    if (polygons.length === 0) continue;
    if (feature.alphaCode.includes("\n")) {
      throw new BordersFormatError(`Alpha code contains a newline: ${JSON.stringify(feature.alphaCode)}`);
    }
    if (!Number.isInteger(feature.adminLevel) || feature.adminLevel < 0 || feature.adminLevel > 255) {
      throw new BordersFormatError(`Admin level of ${feature.alphaCode} is not an integer in 0..255: ${feature.adminLevel}`);
    }

    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          coords.push(lon, lat);
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        ringOffsets.push(coords.length / 2);
      }
      polyRingStart.push(ringOffsets.length - 1);
    }
    featurePolyStart.push(polyRingStart.length - 1);
    alphaCodes.push(feature.alphaCode);
    adminLevel.push(feature.adminLevel);
    area.push(feature.area);
    bbox.push(minLon, minLat, maxLon, maxLat);
  }

  if (alphaCodes.length === 0) {
    throw new BordersFormatError("No feature with vertices to build tables from");
  }

  return {
    coords: Float64Array.from(coords),
    area: Float64Array.from(area),
    bbox: Float64Array.from(bbox),
    featurePolyStart: Uint32Array.from(featurePolyStart),
    polyRingStart: Uint32Array.from(polyRingStart),
    ringOffsets: Uint32Array.from(ringOffsets),
    adminLevel: Uint8Array.from(adminLevel),
    alphaCodes,
  };
}

export function serialize(tables: BorderTables): Uint8Array {
  if (!isLittleEndian()) {
    throw new BordersFormatError("Big-endian platforms are not supported");
  }
  const codes = new TextEncoder().encode(tables.alphaCodes.join("\n"));
  const counts: Counts = {
    featureCount: tables.alphaCodes.length,
    polygonCount: tables.polyRingStart.length - 1,
    ringCount: tables.ringOffsets.length - 1,
    vertexCount: tables.coords.length / 2,
    codesByteLength: codes.length,
  };
  const at = layout(counts);
  const out = new Uint8Array(at.total);
  const view = new DataView(out.buffer);

  out.set(MAGIC, 0);
  view.setUint32(4, FORMAT_VERSION, true);
  view.setUint32(8, counts.featureCount, true);
  view.setUint32(12, counts.polygonCount, true);
  view.setUint32(16, counts.ringCount, true);
  view.setUint32(20, counts.vertexCount, true);
  view.setUint32(24, counts.codesByteLength, true);
  view.setUint32(28, 0, true);

  const put = (offset: number, data: ArrayBufferView): void => {
    out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
  };
  put(at.coords, tables.coords);
  put(at.area, tables.area);
  put(at.bbox, tables.bbox);
  put(at.featurePolyStart, tables.featurePolyStart);
  put(at.polyRingStart, tables.polyRingStart);
  put(at.ringOffsets, tables.ringOffsets);
  put(at.adminLevel, tables.adminLevel);
  out.set(codes, at.codes);
  return out;
}

function checkOffsets(name: string, offsets: Uint32Array, end: number): void {
  if (offsets[0] !== 0) {
    throw new BordersFormatError(`${name} does not start at 0`);
  }
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] < offsets[i - 1]) {
      throw new BordersFormatError(`${name} decreases at index ${i}`);
    }
  }
  if (offsets[offsets.length - 1] !== end) {
    throw new BordersFormatError(`${name} ends at ${offsets[offsets.length - 1]}, expected ${end}`);
  }
}

export function deserialize(bytes: Uint8Array): BorderTables {
  if (!isLittleEndian()) {
    throw new BordersFormatError("Big-endian platforms are not supported");
  }
  if (bytes.length < HEADER_BYTES) {
    throw new BordersFormatError(`Borders data too short: ${bytes.length} bytes`);
  }
  const own = new Uint8Array(bytes);
  const view = new DataView(own.buffer);

  for (let i = 0; i < MAGIC.length; i++) {
    if (own[i] !== MAGIC[i]) {
      throw new BordersFormatError("Not a borders file: bad magic");
    }
  }
  const version = view.getUint32(4, true);
  if (version !== FORMAT_VERSION) {
    throw new BordersFormatError(`Unsupported borders format version ${version}`);
  }
  const counts: Counts = {
    featureCount: view.getUint32(8, true),
    polygonCount: view.getUint32(12, true),
    ringCount: view.getUint32(16, true),
    vertexCount: view.getUint32(20, true),
    codesByteLength: view.getUint32(24, true),
  };
  const at = layout(counts);
  if (own.length !== at.total) {
    throw new BordersFormatError(`Borders data is ${own.length} bytes, header implies ${at.total}`);
  }

  const { featureCount, polygonCount, ringCount, vertexCount } = counts;
  const codesText = new TextDecoder().decode(own.subarray(at.codes, at.codes + counts.codesByteLength));
  const alphaCodes = codesText.length === 0 ? [] : codesText.split("\n");
  if (alphaCodes.length !== featureCount) {
    throw new BordersFormatError(`Found ${alphaCodes.length} alpha codes for ${featureCount} features`);
  }

  const base = own.buffer;
  const featurePolyStart = new Uint32Array(base, at.featurePolyStart, featureCount + 1);
  const polyRingStart = new Uint32Array(base, at.polyRingStart, polygonCount + 1);
  const ringOffsets = new Uint32Array(base, at.ringOffsets, ringCount + 1);
  checkOffsets("Feature-to-polygon table", featurePolyStart, polygonCount);
  checkOffsets("Polygon-to-ring table", polyRingStart, ringCount);
  checkOffsets("Ring-to-vertex table", ringOffsets, vertexCount);

  return {
    coords: new Float64Array(base, at.coords, vertexCount * 2),
    area: new Float64Array(base, at.area, featureCount),
    bbox: new Float64Array(base, at.bbox, featureCount * 4),
    featurePolyStart,
    polyRingStart,
    ringOffsets,
    adminLevel: new Uint8Array(base, at.adminLevel, featureCount),
    alphaCodes,
  };
}
