import fc from "fast-check";

// Seed sweep support: with FC_SEED unset this file does nothing.
if (process.env.FC_SEED !== undefined && process.env.FC_SEED !== "") {
  fc.configureGlobal({ seed: Number(process.env.FC_SEED) });
}
