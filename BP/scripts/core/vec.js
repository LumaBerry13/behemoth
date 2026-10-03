// Small Vector3 helpers. Pure functions, no Script API access.

/** @typedef {{ x: number, y: number, z: number }} V3 */

/** @param {V3} a @param {V3} b @returns {V3} */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
/** @param {V3} a @param {V3} b @returns {V3} */
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
/** @param {V3} a @param {number} s @returns {V3} */
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
/** @param {V3} a */
export const length = (a) => Math.hypot(a.x, a.y, a.z);
/** @param {V3} a @param {V3} b */
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** @param {V3} a @returns {V3} */
export const normalize = (a) => {
  const l = length(a);
  return l > 1e-6 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
/** Horizontal unit direction from a to b (y = 0). @param {V3} a @param {V3} b @returns {V3} */
export const flatDirection = (a, b) => normalize({ x: b.x - a.x, y: 0, z: b.z - a.z });

/**
 * Rotate a model-space offset around Y by a Minecraft yaw (degrees) — used by
 * baked bone lookup (design doc §6). [VERIFY: sign convention vs rendered body yaw]
 * @param {V3} v @param {number} yawDeg @returns {V3}
 */
export const rotateYaw = (v, yawDeg) => {
  const r = (yawDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
};

/**
 * Points on a horizontal circle.
 * @param {V3} center @param {number} radius @param {number} points @returns {V3[]}
 */
export const ring = (center, radius, points) => {
  const out = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    out.push({ x: center.x + Math.cos(a) * radius, y: center.y, z: center.z + Math.sin(a) * radius });
  }
  return out;
};
