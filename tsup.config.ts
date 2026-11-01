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

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  esbuildOptions(options, { format }) {
    if (format === "cjs") {
      // tsup's own shim builds the URL as `file:${__filename}`, which breaks on a path containing # or %.
      options.define = { ...options.define, "import.meta.url": "__importMetaUrl" };
      options.banner = {
        ...options.banner,
        js: '"use strict";\nconst __importMetaUrl = require("node:url").pathToFileURL(__filename).href;',
      };
    }
  },
});
