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
/** MythicMobs condition actions: "cond castInstead other" / "cond orElseCast other". */
const ACTION_RE = /\s+(castinstead|orelsecast)\s+([\w:.\-]+)\s*$/i;

/**
 * @typedef {{ kind: "castInstead" | "orElseCast", skill: string }} ConditionAction
 * @param {string} spec
 * @returns {{ name: string, negate: boolean, args: import("../types/config").ConditionArgs, action?: ConditionAction } | { error: string }}
 */
export function parseCondition(spec) {
  /** @type {ConditionAction | undefined} */
  let action;
  const a = ACTION_RE.exec(spec);
  if (a) {
    action = { kind: a[1].toLowerCase() === "castinstead" ? "castInstead" : "orElseCast", skill: a[2] };
    spec = spec.slice(0, a.index);
  }
  const m = CONDITION_RE.exec(spec.trim());
  if (!m) return { error: `cannot parse condition "${spec}"` };
  const [, bang, name, op, opValue, braces, spaced] = m;
  /** @type {import("../types/config").ConditionArgs} */
  let args = {};
  if (op) args = { op: /** @type {any} */ (op), value: parseValue(opValue) };
  else if (braces !== undefined) args = parseOptions(braces);
  else if (spaced !== undefined) args = { value: parseValue(spaced) };
  return action ? { name, negate: !!bang, args, action } : { name, negate: !!bang, args };
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

// ---------------------------------------------------------------------------
// <placeholders> (resolved at run time by core/Variables.js)
// ---------------------------------------------------------------------------
/** Matches one `<scope.field>` placeholder. */
export const TOKEN = /<([a-zA-Z_][\w.\-]*)>/g;

/** True if a value is a string containing at least one `<...>` placeholder. @param {unknown} v */
export function hasPlaceholder(v) {
  return typeof v === "string" && /<[a-zA-Z_][\w.\-]*>/.test(v);
}

/**
 * Turn a resolved placeholder string back into a typed value: "3" → 3,
 * "true" → true, anything else stays a string.
 * @param {string} s
 */
export function coerce(s) {
  const t = s.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return s;
}

/**
 * Value used to validate an option that contains placeholders: every
 * placeholder becomes "1", so "-<caster.var.x>" validates as -1.
 * @param {string} s
 */
export function sampleValue(s) {
  return coerce(s.replace(TOKEN, "1"));
}
