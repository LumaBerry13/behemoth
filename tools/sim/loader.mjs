// Node module hooks for the headless simulator: the game modules resolve to
// in-memory stubs, so the real framework and boss-pack scripts run unchanged.
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const STUBS = {
  "@minecraft/server": "mc_stub.mjs",
  "@minecraft/server-ui": "ui_stub.mjs",
};

export async function resolve(specifier, context, next) {
  if (STUBS[specifier]) return { url: pathToFileURL(join(here, STUBS[specifier])).href, shortCircuit: true };
  return next(specifier, context);
}
