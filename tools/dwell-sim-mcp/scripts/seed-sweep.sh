#!/usr/bin/env bash
# Runs the dwell-sim-mcp suite once per fast-check global seed (FC_SEED), then the
# property-7 files once per P7_SEED. Prints one summary table and any failure details.
# Temp files live in a mktemp dir that is removed on exit. Exit 1 if anything failed.
set -u
PKG="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PKG" || exit 2
TMP="$(mktemp -d "${TMPDIR:-/tmp}/seed-sweep.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT INT TERM
START=$(date +%s)

# Node helper: reads a vitest JSON report, prints "pass fail" counts, then failing file/test/message lines.
cat > "$TMP/summ.mjs" <<'JS'
import { readFileSync } from "node:fs";
const [, , file, label] = process.argv;
let r;
try { r = JSON.parse(readFileSync(file, "utf8")); } catch { console.log("CRASH 0 0"); process.exit(0); }
const failed = [];
let p = 0, f = 0;
for (const s of r.testResults ?? []) {
  const rel = s.name.replace(process.cwd() + "/", "");
  if (s.status === "failed" && (s.assertionResults ?? []).every((a) => a.status !== "failed")) {
    f++; failed.push({ rel, name: "(suite error)", msg: s.message ?? "" });
  }
  for (const a of s.assertionResults ?? []) {
    if (a.status === "failed") { f++; failed.push({ rel, name: a.fullName, msg: (a.failureMessages ?? []).join("\n") }); }
    else if (a.status === "passed") p++;
  }
}
console.log(`RESULT ${p} ${f}`);
console.log("FILES " + [...new Set(failed.map((x) => x.rel))].join(","));
for (const x of failed) console.log(`DETAIL [${label}] ${x.rel} :: ${x.name}\n${x.msg.split("\n").slice(0, 40).join("\n")}\n---`);
JS

ROWS=""
DETAILS=""
FAIL=0
run() { # group seedvar seed [files...]
  local group="$1" var="$2" seed="$3"; shift 3
  local out="$TMP/out.json"
  rm -f "$out"
  env "$var=$seed" npx vitest run --reporter=json --outputFile="$out" "$@" >"$TMP/stdout.txt" 2>&1
  local code=$?
  local s; s="$(node "$TMP/summ.mjs" "$out" "$group $var=$seed")"
  local res files
  res="$(printf '%s\n' "$s" | sed -n 's/^RESULT //p;s/^CRASH .*/CRASH/p' | head -1)"
  files="$(printf '%s\n' "$s" | sed -n 's/^FILES //p')"
  local status="pass"
  if [ "$code" -ne 0 ] || [ "$res" = "CRASH" ]; then
    status="FAIL"; FAIL=1
    [ "$res" = "CRASH" ] && DETAILS="$DETAILS[$group $var=$seed] vitest produced no report:\n$(tail -20 "$TMP/stdout.txt")\n---\n"
  fi
  local detail; detail="$(printf '%s\n' "$s" | sed -n '/^DETAIL /,$p')"
  [ -n "$detail" ] && DETAILS="$DETAILS$detail\n"
  ROWS="$ROWS$(printf '%-22s %-12s %-10s %-6s %s' "$group" "$var" "$seed" "$status" "${files:-}")\n"
}

SEEDS=""
for i in $(seq 1 20); do SEEDS="$SEEDS $((7919 * i))"; done
SEEDS="$SEEDS -1 -7919 -2147483648"
for seed in $SEEDS; do run "full-suite" FC_SEED "$seed"; done
for seed in $(seq 1 25); do
  run "property-7" P7_SEED "$seed" test/property-7-frame-rate.props.test.ts test/property-7-regression.test.ts
done

printf '\n%-22s %-12s %-10s %-6s %s\n' GROUP VAR SEED RESULT FAILING_FILES
printf '%s\n' "----------------------------------------------------------------------"
printf '%b' "$ROWS"
if [ -n "$DETAILS" ]; then printf '\n=== FAILURE DETAILS ===\n'; printf '%b' "$DETAILS"; fi
printf '\nelapsed: %ss\n' "$(( $(date +%s) - START ))"
if [ "$FAIL" -ne 0 ]; then echo "SEED SWEEP: FAILED"; exit 1; fi
echo "SEED SWEEP: all passed"
