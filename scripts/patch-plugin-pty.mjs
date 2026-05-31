/**
 * Patches the PLUGIN COPY of node-pty for Obsidian's Electron:
 * 1. utils.js          — use __dirname-based absolute paths for .node binaries
 * 2. windowsConoutConnection.js — remove Worker, use main-thread net.Socket
 * 3. windowsPtyAgent.js — remove child_process.fork for console process list
 */
import fs from "fs";
import path from "path";

const BASE = "D:/mindmap/MindMap/.obsidian/plugins/obsidian-brain-terminal/node_modules/node-pty/lib";

// ── 1. utils.js — absolute path for native modules ──────────────────────────
const utilsPath = path.join(BASE, "utils.js");
fs.writeFileSync(utilsPath, `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNativeModule = exports.assign = void 0;
var path = require("path");
function assign(target) {
  var sources = [];
  for (var _i = 1; _i < arguments.length; _i++) { sources[_i - 1] = arguments[_i]; }
  sources.forEach(function(source) { return Object.keys(source).forEach(function(key) { return target[key] = source[key]; }); });
  return target;
}
exports.assign = assign;
function loadNativeModule(name) {
  // Use __dirname so paths resolve correctly when loaded from plugin dir
  var dirs = [
    path.join(__dirname, '..', 'build', 'Release'),
    path.join(__dirname, '..', 'build', 'Debug'),
    path.join(__dirname, '..', 'prebuilds', process.platform + '-' + process.arch),
  ];
  var lastError;
  for (var i = 0; i < dirs.length; i++) {
    try {
      return { dir: dirs[i], module: require(path.join(dirs[i], name + '.node')) };
    } catch(e) { lastError = e; }
  }
  throw new Error('Failed to load native module: ' + name + '.node: ' + lastError);
}
exports.loadNativeModule = loadNativeModule;
`, "utf8");
console.log("[patch] utils.js");

// ── 2. windowsConoutConnection.js — no Worker, main-thread net pipe ──────────
const conoutPath = path.join(BASE, "windowsConoutConnection.js");
fs.writeFileSync(conoutPath, `// [brain-terminal-patched]
"use strict";
var net = require("net");
var events = require("events");

class ConoutConnection extends events.EventEmitter {
  constructor(conoutPipeName) {
    super();
    this._conoutPipeName = conoutPipeName;
    this._conoutSocket = null;
    this._server = null;
    this._drainTimeout = null;
    this._isReady = false;

    var self = this;
    var workerPipe = conoutPipeName + "-bt";

    // Server bridges conout pipe -> outSocket
    this._server = net.createServer(function(clientSocket) {
      if (self._conoutSocket) {
        self._conoutSocket.pipe(clientSocket);
        self._conoutSocket.on("error", function() { clientSocket.destroy(); });
      }
    });

    this._server.on("error", function(e) { console.error("[brain-terminal] conout server error", e.message); });

    this._server.listen(workerPipe, function() {
      self._conoutSocket = new net.Socket();
      self._conoutSocket.setEncoding("utf8");
      self._conoutSocket.connect(conoutPipeName, function() {
        self._isReady = true;
        self.emit("ready");
      });
      self._conoutSocket.on("error", function(e) {
        console.error("[brain-terminal] conout socket error", e.message);
      });
    });
  }

  onReady(listener) {
    if (this._isReady) { listener(); return; }
    this.once("ready", listener);
  }

  connectSocket(socket) {
    socket.connect(this._conoutPipeName + "-bt");
  }

  dispose() {
    if (this._drainTimeout) { clearTimeout(this._drainTimeout); this._drainTimeout = null; }
    this._cleanup();
  }

  _cleanup() {
    try { if (this._conoutSocket) { this._conoutSocket.unpipe(); this._conoutSocket.destroy(); } } catch(e) {}
    try { if (this._server) { this._server.close(); } } catch(e) {}
    this._conoutSocket = null;
    this._server = null;
  }
}

module.exports = { ConoutConnection: ConoutConnection };
`, "utf8");
console.log("[patch] windowsConoutConnection.js");

// ── 3. windowsPtyAgent.js — remove fork() for console process list ───────────
const agentPath = path.join(BASE, "windowsPtyAgent.js");
let agentSrc = fs.readFileSync(agentPath, "utf8");

// Replace _getConsoleProcessList to avoid child_process.fork (broken in Obsidian)
agentSrc = agentSrc.replace(
  /WindowsPtyAgent\.prototype\._getConsoleProcessList\s*=\s*function[^}]+\{[\s\S]*?(\};)\s*\n/,
  `WindowsPtyAgent.prototype._getConsoleProcessList = function() {
    var _this = this;
    return Promise.resolve([_this._innerPid]);
};\n`
);

fs.writeFileSync(agentPath, agentSrc, "utf8");
console.log("[patch] windowsPtyAgent.js");

console.log("[patch-plugin-pty] all patches applied");
