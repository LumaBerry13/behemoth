// Debug overlay (action bar) and bone markers (design doc §11).
import { Adapter } from "../adapter/Adapter.js";

const OVERLAY_INTERVAL = 5;
const OVERLAY_RANGE = 48;
const BONE_PARTICLE = "minecraft:basic_flame_particle";

/** @param {import("../core/services.js").Services} services */
export function startDebugOverlay(services) {
  services.scheduler.onTick((tick) => {
    if (services.settings.boneMarkers) drawBones(services);
    if (services.settings.overlay && tick % OVERLAY_INTERVAL === 0) drawOverlay(services, tick);
  });
}

/** @param {import("../core/services.js").Services} services @param {number} tick */
function drawOverlay(services, tick) {
  for (const p of Adapter.getAllPlayers()) {
    const boss = services.bosses.nearest(p.dimension, p.location, OVERLAY_RANGE);
    if (!boss) continue;
    const h = Adapter.getHealth(boss.entity);
    const runs = [...boss.runs].map((r) => r.skill.name).join(",") || "-";
    const cds = [...boss.cooldowns]
      .filter(([, at]) => at > tick)
      .map(([n, at]) => `${n}:${at - tick}`)
      .join(" ") || "-";
    const target = boss.getTarget();
    const lock = boss.isCastLocked(tick) ? "§cL§r" : "§aU§r";
    Adapter.actionBar(
      p,
      `§e${boss.config.id}§r P${boss.phase} HP ${Math.ceil(h.current)}/${h.max} AI:${boss.aiMode} ${lock}\n` +
        `run: ${runs} | cd: ${cds} | tgt: ${target ? target.nameTag || target.typeId : "-"}`
    );
  }
}

/** Particle at every baked bone of the current animation (calibration). @param {import("../core/services.js").Services} services */
function drawBones(services) {
  for (const boss of services.bosses.all()) {
    const bones = boss.anim?.data.bones;
    if (!bones) continue;
    const locs = [];
    for (const name of Object.keys(bones)) {
      const pos = boss.getBonePosition(name);
      if (pos) locs.push(pos);
    }
    Adapter.spawnParticles(boss.dimension, BONE_PARTICLE, locs);
  }
}
