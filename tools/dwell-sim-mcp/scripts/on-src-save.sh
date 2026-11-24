#!/usr/bin/env bash
# Hook helper: typecheck the package and run tests that import the saved module.
# Path comes from the first argument, else from STDIN JSON. Quiet on success; exit 1 on failure.
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/tools/dwell-sim-mcp"
FILE="${1:-}"
if [ -z "$FILE" ] && [ ! -t 0 ]; then
  INPUT="$(cat)"
  FILE="$(printf '%s' "$INPUT" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch{process.exit(0)}
  const keys=["file_path","filePath","path","file"];
  const seen=new Set();
  const find=o=>{if(!o||typeof o!=="object"||seen.has(o))return;seen.add(o);
    for(const k of keys)if(typeof o[k]==="string"&&o[k].endsWith(".ts")){console.log(o[k]);process.exit(0)}
    for(const v of Object.values(o))find(v)};
  find(j);
  for(const k of keys)if(typeof j[k]==="string"){console.log(j[k]);break}
})')"
fi
[ -z "$FILE" ] && FILE="${KIRO_FILE_PATH:-${FILE_PATH:-}}"
if [ -z "$FILE" ]; then echo "on-src-save: no file path found" >&2; exit 1; fi
case "$FILE" in /*) ABS="$FILE" ;; *) ABS="$ROOT/$FILE" ;; esac
REL="${ABS#"$PKG"/}"

cd "$PKG" || exit 2
OUT="$(npx tsc --noEmit -p tsconfig.json 2>&1)"; TSC=$?
TESTS=0
case "$REL" in
  src/*.ts) OUT2="$(npx vitest related "$REL" --run --passWithNoTests --reporter=dot 2>&1)"; TESTS=$? ;;
  *) OUT2="" ;;
esac
if [ "$TSC" -ne 0 ]; then echo "tsc failed for $REL:"; echo "$OUT"; fi
if [ "$TESTS" -ne 0 ]; then echo "vitest related failed for $REL:"; echo "$OUT2"; fi
[ "$TSC" -eq 0 ] && [ "$TESTS" -eq 0 ]
