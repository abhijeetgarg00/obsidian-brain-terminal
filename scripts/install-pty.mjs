/**
 * Rebuilds node-pty's native .node binary against Obsidian's Electron ABI.
 * Run with: npm run install:pty
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ptyDir = path.join(__dirname, "..", "node_modules", "node-pty");

if (!existsSync(ptyDir)) {
  console.error("[install-pty] node-pty not found — run npm install first");
  process.exit(1);
}

// Detect Obsidian's Electron version
let electronVersion = "32";
try {
  // Try to detect from Obsidian's package.json or app.asar
  const obsidianPath = "C:/Users/" + process.env["USERNAME"] + "/AppData/Local/Obsidian";
  const pkgPath = path.join(obsidianPath, "resources", "app", "package.json");
  if (existsSync(pkgPath)) {
    const { readFileSync } = await import("fs");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const ver = pkg.electronVersion ?? pkg.devDependencies?.electron ?? "";
    const match = ver.match(/(\d+)/);
    if (match) electronVersion = match[1];
  }
} catch {
  console.log("[install-pty] could not detect Electron version, using", electronVersion);
}

console.log(`[install-pty] rebuilding node-pty for Electron ${electronVersion}`);

try {
  execSync(
    `npx @electron/rebuild -v ${electronVersion}.0.0 -m . -w node-pty`,
    { cwd: path.join(__dirname, ".."), stdio: "inherit" }
  );
  console.log("[install-pty] done");
} catch {
  console.warn("[install-pty] rebuild failed — trying pre-built binary fallback");
  try {
    execSync(
      `npx node-pre-gyp install --fallback-to-build`,
      { cwd: ptyDir, stdio: "inherit" }
    );
    console.log("[install-pty] fallback done");
  } catch (e) {
    console.error("[install-pty] all rebuild attempts failed:", e.message);
    process.exit(1);
  }
}
