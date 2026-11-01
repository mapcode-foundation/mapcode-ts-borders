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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const esm = await import(new URL("dist/index.js", root).href);
const cjs = createRequire(import.meta.url)(fileURLToPath(new URL("dist/index.cjs", root)));

for (const [format, api] of [["esm", esm], ["cjs", cjs]]) {
  const borders = api.Borders.fromBytes(new Uint8Array(await readFile(api.bordersUrl)));
  const codes = borders.getTerritories(34.0522, -118.2437).map((m) => m.territory.toString());
  assert.deepEqual(codes, ["US-CA", "USA"], `${format}: Los Angeles territories`);
  assert.equal(borders.getSource().snapshotDate, "2026-05", `${format}: snapshot date`);
  console.log(`${format}: ok`);
}
