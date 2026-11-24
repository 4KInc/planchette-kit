// Test-only preload (NODE_OPTIONS=--import). Records any attempt to open a network connection or
// listener by writing to the file named in DWELL_SIM_NET_LOG, then throws.
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const log = process.env.DWELL_SIM_NET_LOG;

function trap(owner, name, label) {
  owner[name] = function trapped() {
    if (log) appendFileSync(log, `${label}\n`);
    throw new Error(`network use blocked by test preload: ${label}`);
  };
}

const net = require("node:net");
trap(net.Socket.prototype, "connect", "net.Socket.connect");
trap(net.Server.prototype, "listen", "net.Server.listen");
trap(net, "connect", "net.connect");
trap(net, "createConnection", "net.createConnection");
trap(net, "createServer", "net.createServer");

const dgram = require("node:dgram");
trap(dgram, "createSocket", "dgram.createSocket");
trap(dgram.Socket.prototype, "bind", "dgram.Socket.bind");
trap(dgram.Socket.prototype, "send", "dgram.Socket.send");
