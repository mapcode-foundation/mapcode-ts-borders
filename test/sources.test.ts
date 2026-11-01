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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string): string => readFileSync(join(import.meta.dirname, "..", "src", name), "utf8");
const imports = (text: string): string[] =>
  [...text.matchAll(/^\s*import\b[^;]*?from\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/gm)].map((m) => m[1] ?? m[2]);

describe("modules the converter loads without a build", () => {
  it("keeps src/format.ts free of imports", () => {
    expect(read("format.ts")).not.toMatch(/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m);
  });

  it("lets src/alpha-code.ts import only mapcode-ts", () => {
    expect(imports(read("alpha-code.ts"))).toEqual(["mapcode-ts"]);
  });
});
