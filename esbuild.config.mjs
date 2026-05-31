import esbuild from "esbuild";
import { builtinModules } from "module";

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
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
];

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  outfile: "main.js",
  external,
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  loader: { ".css": "text" },
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
