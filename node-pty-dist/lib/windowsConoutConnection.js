// [brain-terminal-patched]
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
