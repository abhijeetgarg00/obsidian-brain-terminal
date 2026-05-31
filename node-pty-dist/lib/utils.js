"use strict";
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
