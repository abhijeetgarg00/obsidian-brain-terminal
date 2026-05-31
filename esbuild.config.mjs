import esbuild from "esbuild";
import { builtinModules } from "module";
import fs from "fs";

const prod = process.argv[2] === "production";

const external = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  "node-pty",
  // @xterm/* is NOT external — bundled directly into main.js
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
];

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  outfile: prod
    ? "main.js"
    : "D:/mindmap/MindMap/.obsidian/plugins/obsidian-brain-terminal/main.js",
  external,
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  loader: { ".css": "text" },
});

const PLUGIN_DIR = "D:/mindmap/MindMap/.obsidian/plugins/obsidian-brain-terminal";

function copyStyles() {
  try {
    fs.copyFileSync("styles.css", `${PLUGIN_DIR}/styles.css`);
  } catch { /* vault not present in prod */ }
}

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  copyStyles();
  await ctx.watch();
}
