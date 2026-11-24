---
inclusion: manual
---

# Seed sweep

Run `bash tools/dwell-sim-mcp/scripts/seed-sweep.sh` from the project root and wait for it to finish (a few minutes). It runs the dwell-sim-mcp suite once per fast-check global seed (7919×1..20, -1, -7919, -2147483648) and the property-7 files once per `P7_SEED` 1..25.

Report the summary table, then for every failing row name the failing file, test, and the printed assertion or counterexample. Do not edit code or tests unless asked. Report the exit code and elapsed time.
