// Bundles src/ into dist/index.js + dist/manifest.json. Only needs `esbuild`.
//
// Vendetta-lineage loaders (Revenge Classic) evaluate the file as:
//     (0, eval)("vendetta=>{return " + <contents of index.js> + "}")(vendetta)
// so index.js must be ONE BARE EXPRESSION that evaluates to the plugin (`{default: {...}}` or `{...}`),
// and must NOT add its own `vendetta=>{return ...}` wrapper (that double-wraps and fails to enable).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const manifest = JSON.parse(await readFile("./manifest.json", "utf8"));

// "@vendetta/metro/common" -> the global `vendetta.metro.common`
const vendettaExternals = {
    name: "vendetta-externals",
    setup(b) {
        b.onResolve({ filter: /^@vendetta(\/|$)/ }, args => ({ path: args.path, namespace: "vendetta-global" }));
        b.onLoad({ filter: /.*/, namespace: "vendetta-global" }, args => ({
            contents: `module.exports = ${args.path.slice(1).replace(/\//g, ".")};`,
            loader: "js"
        }));
    }
};

const result = await build({
    entryPoints: [manifest.main],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "$",
    target: "es2019", // Hermes-friendly: downlevels `??=`, etc.
    minify: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    logLevel: "warning",
    plugins: [vendettaExternals]
});

// `var $=(()=>{...})();`  ->  `(()=>{...})()`
const code = result.outputFiles[0].text.trim()
    .replace(/^(["']use strict["'];)?\s*var \$=/, "")
    .replace(/;$/, "");
if (/^(var|"use strict")/.test(code) || !/^[(!]|^function/.test(code)) throw new Error("Unexpected bundle shape; expected a single expression:\n" + code.slice(0, 120));

await mkdir("dist", { recursive: true });
await writeFile("dist/index.js", code);
await writeFile("dist/manifest.json", JSON.stringify({ ...manifest, main: "index.js", hash: createHash("sha256").update(code).digest("hex") }, null, 2));
console.log(`Built ${manifest.name} -> dist/ (${code.length} bytes)`);
