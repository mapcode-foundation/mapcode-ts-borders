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
  featureCount: number;
  polygonCount: number;
  ringCount: number;
  vertexCount: number;
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

const align8 = (n: number): number => (n + 7) & ~7;

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
  const coordsList: number[] = [];
  const ringOffsetsList: number[] = [0];
  const polyRingStartList: number[] = [0];
  const featurePolyStartList: number[] = [0];
  const alphaCodes: string[] = [];
  const adminLevelList: number[] = [];
  const areaList: number[] = [];
  const bboxList: number[] = [];

  let ringCount = 0;
  let polyCount = 0;
  let vertexCount = 0;

  for (const feature of features) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    const polyCountBefore = polyCount;

    for (const polygon of feature.polygons) {
      const ringCountBefore = ringCount;
      const vertexCountBefore = vertexCount;
      const coordsLengthBefore = coordsList.length;
      const ringOffsetsLengthBefore = ringOffsetsList.length;
      for (const ring of polygon) {
        for (const [lon, lat] of ring) {
          coordsList.push(lon, lat);
          vertexCount++;
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        ringCount++;
        ringOffsetsList.push(vertexCount);
      }
      if (vertexCount === vertexCountBefore) {
        ringCount = ringCountBefore;
        coordsList.length = coordsLengthBefore;
        ringOffsetsList.length = ringOffsetsLengthBefore;
        continue;
      }
      polyCount++;
      polyRingStartList.push(ringCount);
    }

    if (polyCount === polyCountBefore) continue;
    if (feature.alphaCode.includes("\n")) {
      throw new BordersFormatError(`Alpha code contains a newline: ${JSON.stringify(feature.alphaCode)}`);
    }
    featurePolyStartList.push(polyCount);
    alphaCodes.push(feature.alphaCode);
    adminLevelList.push(feature.adminLevel);
    areaList.push(feature.area);
    bboxList.push(minLon, minLat, maxLon, maxLat);
  }

  if (alphaCodes.length === 0) {
    throw new BordersFormatError("No feature with vertices to build tables from");
  }

  return {
    featureCount: alphaCodes.length,
    polygonCount: polyCount,
    ringCount,
    vertexCount,
    coords: Float64Array.from(coordsList),
    area: Float64Array.from(areaList),
    bbox: Float64Array.from(bboxList),
    featurePolyStart: Uint32Array.from(featurePolyStartList),
    polyRingStart: Uint32Array.from(polyRingStartList),
    ringOffsets: Uint32Array.from(ringOffsetsList),
    adminLevel: Uint8Array.from(adminLevelList),
    alphaCodes,
  };
}

export function serialize(tables: BorderTables): Uint8Array {
  if (!isLittleEndian()) {
    throw new BordersFormatError("Big-endian platforms are not supported");
  }
  const codes = new TextEncoder().encode(tables.alphaCodes.join("\n"));
  const counts: Counts = {
    featureCount: tables.featureCount,
    polygonCount: tables.polygonCount,
    ringCount: tables.ringCount,
    vertexCount: tables.vertexCount,
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

export function deserialize(bytes: Uint8Array): BorderTables {
  if (!isLittleEndian()) {
    throw new BordersFormatError("Big-endian platforms are not supported");
  }
  if (bytes.length < HEADER_BYTES) {
    throw new BordersFormatError(`Borders data too short: ${bytes.length} bytes`);
  }
  const aligned = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);

  for (let i = 0; i < MAGIC.length; i++) {
    if (aligned[i] !== MAGIC[i]) {
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
  if (aligned.length !== at.total) {
    throw new BordersFormatError(`Borders data is ${aligned.length} bytes, header implies ${at.total}`);
  }

  const base = aligned.buffer;
  const origin = aligned.byteOffset;
  const { featureCount, polygonCount, ringCount, vertexCount } = counts;
  const codesText = new TextDecoder().decode(aligned.subarray(at.codes, at.codes + counts.codesByteLength));
  const alphaCodes = codesText.length === 0 ? [] : codesText.split("\n");
  if (alphaCodes.length !== featureCount) {
    throw new BordersFormatError(`Found ${alphaCodes.length} alpha codes for ${featureCount} features`);
  }

  return {
    featureCount,
    polygonCount,
    ringCount,
    vertexCount,
    coords: new Float64Array(base, origin + at.coords, vertexCount * 2),
    area: new Float64Array(base, origin + at.area, featureCount),
    bbox: new Float64Array(base, origin + at.bbox, featureCount * 4),
    featurePolyStart: new Uint32Array(base, origin + at.featurePolyStart, featureCount + 1),
    polyRingStart: new Uint32Array(base, origin + at.polyRingStart, polygonCount + 1),
    ringOffsets: new Uint32Array(base, origin + at.ringOffsets, ringCount + 1),
    adminLevel: new Uint8Array(base, origin + at.adminLevel, featureCount),
    alphaCodes,
  };
}
