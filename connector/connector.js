// Behemoth connector — protocol v1.
// Copy this file UNCHANGED into a boss pack (BP/scripts/behemoth/connector.js) and call
//   connect({ pack: "my_pack", version: "1.0.0", minFramework: "0.2.0", bosses: [config, ...] })
// from the pack's main script. The Behemoth framework pack must be installed (declare it
// as a manifest dependency); it validates and drives the bosses.
//
// How it works: the pack says hello with a hash of its payload. If the framework already
// has that exact payload cached (normal case after /reload), nothing else is sent. If not,
// the framework asks for it and the payload is streamed as script-event parts; a part that
// is too long for the engine makes the connector retry with smaller parts.
//
// Boss configs must be plain data (JSON): functions are not transferable and are reported.
import { system } from "@minecraft/server";

const PROTOCOL = 1;
const MAX_PART = 8000;
const MIN_PART = 256;
const RETRY_TICKS = 200;
const MAX_HELLOS = 4;
const PACK_ID = /^[a-z0-9_.:-]{1,64}$/;
const TAG = "[Behemoth connector]";

/** FNV-1a 32-bit over UTF-16 code units (must match the framework). @param {string} s */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** @param {string} id @param {string} message */
function trySend(id, message) {
  try {
    system.sendScriptEvent(id, message);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ pack: string, version: string, minFramework?: string, bosses: object[] }} options
 */
export function connect({ pack, version, minFramework = "0.2.0", bosses }) {
  if (!PACK_ID.test(pack)) throw new Error(`${TAG} invalid pack id "${pack}" (use a-z 0-9 _ . : -)`);
  const payload = JSON.stringify({ ver: version, bosses }, (key, value) => {
    if (typeof value === "function") {
      console.warn(`${TAG} ${pack}: "${key}" is a function; boss configs must be plain data — it was dropped`);
      return undefined;
    }
    return value;
  });
  const hash = fnv1a(payload);
  let part = MAX_PART;
  let acked = false;
  let hellos = 0;

  const hello = () => {
    if (acked || hellos >= MAX_HELLOS) return;
    hellos++;
    trySend("bhm:hello", JSON.stringify({ p: PROTOCOL, pack, ver: version, hash, size: payload.length, min: minFramework }));
    // If the framework missed it (or is not installed), try again a few times.
    system.runTimeout(hello, RETRY_TICKS);
  };

  const sendParts = () => {
    while (part >= MIN_PART) {
      const n = Math.ceil(payload.length / part);
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        ok = trySend("bhm:part", `${pack}|${hash}|${i}|${n}|${payload.slice(i * part, (i + 1) * part)}`);
      }
      if (ok) return;
      part = Math.floor(part / 2); // engine refused the size: resend everything in smaller parts
    }
    console.warn(`${TAG} ${pack}: could not send the boss payload`);
  };

  system.afterEvents.scriptEventReceive.subscribe((e) => {
    if (!e.id.startsWith("bhm:") || e.sourceEntity || e.sourceBlock) return;
    if (e.id === "bhm:ready") {
      acked = false;
      hellos = 0;
      hello();
      return;
    }
    if (e.id !== "bhm:need" && e.id !== "bhm:ack") return;
    let m;
    try {
      m = JSON.parse(e.message);
    } catch {
      return;
    }
    if (m.pack !== pack) return;
    if (e.id === "bhm:need" && m.hash === hash) sendParts();
    if (e.id === "bhm:ack" && m.hash === hash) {
      acked = true;
      for (const err of m.errors ?? []) console.warn(`${TAG} ${pack}: ${err}`);
    }
  });

  system.run(hello);
}
