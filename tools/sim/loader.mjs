// Node module hooks for the headless simulator:
//  - "@minecraft/server" → the in-memory stub (mc_stub.mjs)
//  - bosses/private/index.js → private/build version when it exists (same as deploy)
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const privateIndex = join(root, "private", "build", "BP", "scripts", "bosses", "private", "index.js");

export async function resolve(specifier, context, next) {
  if (specifier === "@minecraft/server") {
    return { url: pathToFileURL(join(here, "mc_stub.mjs")).href, shortCircuit: true };
  }
  if (specifier === "./private/index.js" && context.parentURL?.endsWith("/BP/scripts/bosses/index.js") && existsSync(privateIndex)) {
    return { url: pathToFileURL(privateIndex).href, shortCircuit: true };
  }
  return next(specifier, context);
}
