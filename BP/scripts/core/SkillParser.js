// Parses the string forms used in skill lines (design doc §7):
//   targeter  "@PlayersInRadius{r=10;limit=3}"
//   condition "!hasTarget", "distance<=4", "phase==2", "hasTag{tag=enraged}"
//   trigger   "~onTimer:100", "onDamaged"
// Parsing happens once at startup, never per execution.

/** @param {string} raw */
function parseValue(raw) {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v.replace(/^["']|["']$/g, "");
}

/**
 * "r=4;limit=3" or "r=4,limit=3" → { r: 4, limit: 3 }
 * @param {string | undefined} body
 * @returns {Record<string, any>}
 */
export function parseOptions(body) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!body) return out;
  for (const part of body.split(/[;,]/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq < 0) out[part.trim()] = true;
    else out[part.slice(0, eq).trim()] = parseValue(part.slice(eq + 1));
  }
  return out;
}

/**
 * @param {import("../types/config").TargeterSpec} spec
 * @returns {{ name: string, options: Record<string, any> } | { error: string }}
 */
export function parseTargeter(spec) {
  if (typeof spec === "object" && spec && typeof spec.name === "string") {
    const { name, ...options } = spec;
    return { name: name.replace(/^@/, ""), options };
  }
  if (typeof spec !== "string") return { error: `invalid targeter ${JSON.stringify(spec)}` };
  const m = /^@([A-Za-z_][\w]*)\s*(?:\{(.*)\})?$/.exec(spec.trim());
  if (!m) return { error: `cannot parse targeter "${spec}"` };
  return { name: m[1], options: parseOptions(m[2]) };
}

const CONDITION_RE = /^(!)?\s*([A-Za-z_][\w]*)\s*(?:(<=|>=|==|!=|<|>)\s*(.+)|\{(.*)\}|\s+(.+))?$/;

/**
 * @param {string} spec
 * @returns {{ name: string, negate: boolean, args: import("../types/config").ConditionArgs } | { error: string }}
 */
export function parseCondition(spec) {
  const m = CONDITION_RE.exec(spec.trim());
  if (!m) return { error: `cannot parse condition "${spec}"` };
  const [, bang, name, op, opValue, braces, spaced] = m;
  /** @type {import("../types/config").ConditionArgs} */
  let args = {};
  if (op) args = { op: /** @type {any} */ (op), value: parseValue(opValue) };
  else if (braces !== undefined) args = parseOptions(braces);
  else if (spaced !== undefined) args = { value: parseValue(spaced) };
  return { name, negate: !!bang, args };
}

/**
 * @param {string} spec
 * @returns {{ name: string, arg: string | undefined }}
 */
export function parseTrigger(spec) {
  const s = spec.trim().replace(/^~/, "");
  const i = s.indexOf(":");
  return i < 0 ? { name: s, arg: undefined } : { name: s.slice(0, i), arg: s.slice(i + 1) };
}

/**
 * Compare helper for conditions with operators.
 * @param {number} a @param {string | undefined} op @param {number} b
 */
export function compare(a, op, b) {
  switch (op) {
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "!=": return a !== b;
    case "==":
    default: return a === b;
  }
}
