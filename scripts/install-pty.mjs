/**
 * Rebuilds node-pty's native .node binary against Obsidian's Electron ABI.
 * Run with: npm run install:pty
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ptyDir = path.join(__dirname, "..", "node_modules", "node-pty");

if (!require("fs").existsSync(ptyDir)) {
  console.error("[install-pty] node-pty not found — run npm install first");
  process.exit(1);
}

// Detect Obsidian's Electron version
let electronVersion = "32";
try {
  const { execSync: ex } = await import("child_process");
  // Try to read Electron version from Obsidian's resources
  const candidates = [
    "C:/Users/" + process.env["USERNAME"] + "/AppData/Local/Obsidian/resources/electron.asar",
    "/Applications/Obsidian.app/Contents/Resources/electron.asar",
  ];
  // Fall back to npx @electron/get detection
  const raw = execSync("npx @electron/get --version 2>/dev/null || echo 32", { encoding: "utf8" }).trim();
  electronVersion = raw.match(/\d+/)?.[0] ?? "32";
} catch {
  console.log("[install-pty] could not detect Electron version, using", electronVersion);
}

console.log(`[install-pty] rebuilding node-pty for Electron ${electronVersion}`);

try {
  execSync(
    `npx @electron/rebuild -v ${electronVersion}.x.x -m . -w node-pty`,
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
  } catch (e) {
    console.error("[install-pty] all rebuild attempts failed:", e.message);
    process.exit(1);
  }
}
