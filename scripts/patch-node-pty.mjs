/**
 * Patches node-pty's windowsConoutConnection.js to connect the conout pipe
 * directly on the main thread instead of via a Worker (which Obsidian's
 * Electron does not support). Run automatically on postinstall.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "node-pty",
  "lib",
  "windowsConoutConnection.js"
);

if (!fs.existsSync(target)) {
  console.log("[patch-node-pty] target not found — skipping (non-Windows or not installed yet)");
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");

// Already patched?
if (src.includes("// [brain-terminal-patched]")) {
  console.log("[patch-node-pty] already patched — skipping");
  process.exit(0);
}

// Replace the Worker-based ConoutConnection with a main-thread net.Socket version
const patched = `// [brain-terminal-patched]
"use strict";
const net = require("net");
class ConoutConnection {
  constructor(conoutPipeName) {
    this._drainTimeout = null;
    this._outSocket = new net.Socket();
    this._outSocket.setEncoding("utf8");
    this._outSocket.connect(conoutPipeName);
    this._server = null;
    this._outSocket.on("ready", () => this.emit("ready"));
  }
  onReady(listener) { this._outSocket.once("ready", listener); }
  dispose() {
    if (this._drainTimeout) { clearTimeout(this._drainTimeout); this._drainTimeout = null; }
    this._outSocket.destroy();
  }
}
module.exports = { ConoutConnection };
`;

fs.writeFileSync(target, patched, "utf8");
console.log("[patch-node-pty] patched successfully");
