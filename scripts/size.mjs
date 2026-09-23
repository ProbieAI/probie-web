import { build } from "esbuild";
import { gzipSync } from "node:zlib";

const result = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2018",
  write: false,
});
const bytes = result.outputFiles[0].contents;
console.log(`Complete browser SDK: ${bytes.length} bytes minified; ${gzipSync(bytes).length} bytes gzip.`);
console.log("ESM, ES2018 target, no source map. Application builds may differ.");
