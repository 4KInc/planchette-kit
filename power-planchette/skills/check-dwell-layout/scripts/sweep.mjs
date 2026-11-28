#!/usr/bin/env node
// Seed sweep for the Planchette dwell simulator. Plain Node 20+, no dependencies.
//
// It starts the bundled simulator (dwell-sim-mcp.mjs) over stdio, runs `simulate` for every seed,
// layout and dwell time, and prints ONE compact markdown report. It exists because a single
// `simulate` result is about 65 KB to 340 KB, so 20 or more tool calls would flood the agent's context.
//
// Usage:
//   node sweep.mjs --layout board-1920.json --layout board-1366.json --dwell 2100
//   node sweep.mjs --layout a.json --layout b.json --dwell 1800,1900,2000,2100,2200 --find
//
// Options:
//   --layout <file>     JSON { screen: {width,height}, targets: [...] }. Repeat for each screen size. Required.
//   --dwell <ms,ms>     Dwell times to test, in ms. Default 2100.
//   --find              Test the dwell times in ascending order and stop at the first one that passes the gate
//                       on every layout (the multi-seed rule).
//   --seeds <1-10>      A range or a comma list. Default 1-10.
//   --presets <a,b>     Simulated users. Default: every preset the server lists.
//   --gate-preset <p>   The preset the gate applies to. Default reads-while-pointing.
//   --limit <n>         The gate: worst accidental selections per 100 intended. Default 10.
//   --profile <json>    Extra profile fields of YOUR app, for example '{"headDeadZone":2}'. dwellTime is set per run.
//   --task-each <n>     Task { eachTarget: n }. Default 2.
//   --trials <n>        Trials per user. Default 10.
//   --fps <n>           15, 30 or 60. Default 30.
//   --server <file>     The simulator file. Default: dwell-sim-mcp.mjs three folders above this script.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { layout: [], dwell: "2100", seeds: "1-10", gatePreset: "reads-while-pointing", limit: 10, taskEach: 2, trials: 10, fps: 30, find: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--layout") o.layout.push(next());
    else if (a === "--dwell") o.dwell = next();
    else if (a === "--find") o.find = true;
    else if (a === "--seeds") o.seeds = next();
    else if (a === "--presets") o.presets = next();
    else if (a === "--gate-preset") o.gatePreset = next();
    else if (a === "--limit") o.limit = Number(next());
    else if (a === "--profile") o.profile = JSON.parse(next());
    else if (a === "--task-each") o.taskEach = Number(next());
    else if (a === "--trials") o.trials = Number(next());
    else if (a === "--fps") o.fps = Number(next());
    else if (a === "--server") o.server = next();
    else throw new Error(`Unknown option ${a}`);
  }
  if (o.layout.length === 0) throw new Error("Give at least one --layout <file>.");
  return o;
}

function expandSeeds(text) {
  const range = /^(-?\d+)-(\d+)$/.exec(text);
  if (range) {
    const out = [];
    for (let s = Number(range[1]); s <= Number(range[2]); s++) out.push(s);
    return out;
  }
  return text.split(",").map(Number);
}

const median = (values) => {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const round1 = (x) => (x === null ? "n/a" : String(Math.round(x * 10) / 10));
const roundMs = (x) => (x === null ? "n/a" : String(Math.round(x)));

/** A minimal MCP client over stdio: newline-delimited JSON-RPC. */
function startServer(file) {
  const child = spawn(process.execPath, [file], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  child.on("exit", (code) => {
    for (const w of pending.values()) w.reject(new Error(`The simulator stopped (exit ${code}). ${stderr.trim()}`));
    pending.clear();
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return {
    request,
    notify: (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    call: async (name, args) => {
      const result = await request("tools/call", { name, arguments: args });
      if (result.isError) throw new Error(`${name} returned an error: ${JSON.stringify(result.content)}`);
      return result.structuredContent;
    },
    close: () => child.kill(),
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const server = o.server ?? path.resolve(here, "..", "..", "..", "dwell-sim-mcp.mjs");
  if (!existsSync(server)) throw new Error(`The simulator file is not at ${server}. Pass --server <path to dwell-sim-mcp.mjs>.`);
  const layouts = o.layout.map((file) => ({ name: path.basename(file).replace(/\.json$/, ""), layout: JSON.parse(readFileSync(file, "utf8")) }));
  const seeds = expandSeeds(o.seeds);
  const dwells = o.dwell.split(",").map(Number);
  if (o.find) dwells.sort((a, b) => a - b);

  const sim = startServer(server);
  const warnings = new Set();
  try {
    await sim.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "planchette-sweep", version: "0.1.0" } });
    sim.notify("notifications/initialized");
    const presets = o.presets ? o.presets.split(",") : (await sim.call("list_users", {})).users.map((u) => u.name);
    if (!presets.includes(o.gatePreset)) throw new Error(`The gate preset ${o.gatePreset} is not among the presets tested (${presets.join(", ")}).`);

    const out = [];
    const summary = [];
    let chosen = null;
    for (const dwell of dwells) {
      const rows = [];
      const gateSeeds = [];
      let worstGate = { value: -1, layout: "", seed: 0 };
      for (const { name, layout } of layouts) {
        const per = new Map(presets.map((p) => [p, { acc: [], med: [], p90: [] }]));
        for (const seed of seeds) {
          const result = await sim.call("simulate", {
            layout,
            profile: { ...(o.profile ?? {}), dwellTime: dwell },
            users: presets,
            task: { eachTarget: o.taskEach },
            trialsPerUser: o.trials,
            fps: o.fps,
            seed,
          });
          for (const w of result.warnings) warnings.add(w);
          for (const u of result.users) {
            const bucket = per.get(u.name);
            bucket.acc.push(u.accidentalPer100Intended);
            bucket.med.push(u.timeToSelectMs.median);
            bucket.p90.push(u.timeToSelectMs.p90);
          }
        }
        for (const p of presets) {
          const b = per.get(p);
          const numbers = b.acc.filter((x) => typeof x === "number");
          rows.push({ layout: name, preset: p, worst: Math.max(...numbers), med: median(numbers), best: Math.min(...numbers), tMed: median(b.med), tP90: median(b.p90) });
          if (p === o.gatePreset) {
            gateSeeds.push({ layout: name, values: b.acc });
            numbers.forEach((value, i) => {
              if (value > worstGate.value) worstGate = { value, layout: name, seed: seeds[i] };
            });
          }
        }
      }
      const pass = worstGate.value <= o.limit;
      out.push(`### Dwell time ${dwell} ms`, "", "| Layout | Preset | Worst | Median | Best | Time to select, median / p90 (ms) |", "| --- | --- | --- | --- | --- | --- |");
      for (const r of rows) out.push(`| ${r.layout} | ${r.preset} | ${round1(r.worst)} | ${round1(r.med)} | ${round1(r.best)} | ${roundMs(r.tMed)} / ${roundMs(r.tP90)} |`);
      out.push("", `Accidental selections per 100 intended, ${o.gatePreset}, by seed (${seeds.join(", ")}):`, "", "| Layout | Seeds | Worst |", "| --- | --- | --- |");
      for (const g of gateSeeds) out.push(`| ${g.layout} | ${g.values.map(round1).join(", ")} | ${round1(Math.max(...g.values.filter((x) => typeof x === "number")))} |`);
      const verdict = `${pass ? "PASS" : "FAIL"}: at ${dwell} ms the worst ${o.gatePreset} value is ${round1(worstGate.value)} (${worstGate.layout}, seed ${worstGate.seed}); the gate is at most ${o.limit}.`;
      out.push("", `**${verdict}**`, "");
      summary.push({ dwell, pass, worst: worstGate });
      if (o.find && pass) {
        chosen = dwell;
        break;
      }
    }
    const head = [`# Dwell sweep`, "", `Task { eachTarget: ${o.taskEach} }, ${o.fps} fps, ${o.trials} trials, seeds ${seeds.join(", ")}, layouts ${layouts.map((l) => l.name).join(", ")}. Simulated users are models from published group averages, not real people.`, ""];
    if (o.find) {
      head.push(chosen !== null ? `**Chosen by the multi-seed rule: ${chosen} ms** (the smallest tested dwell time whose worst seed passes on every layout).` : `**No tested dwell time passes** (${dwells.join(", ")} ms). Test longer values or change the layout before choosing one.`, "");
    }
    const uniqueWarnings = [...warnings];
    const tail = uniqueWarnings.length ? ["## Warnings from the simulator", "", ...uniqueWarnings.map((w) => `- ${w}`), ""] : [];
    console.log([...head, ...out, ...tail].join("\n"));
    process.exitCode = o.find ? (chosen !== null ? 0 : 1) : summary.every((s) => s.pass) ? 0 : 1;
  } finally {
    sim.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
});
