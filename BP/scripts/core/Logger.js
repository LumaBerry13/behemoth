// [MB]-prefixed logging with levels (design doc §11).

export const LogLevel = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

let level = /** @type {number} */ (LogLevel.info);

/** @param {unknown[]} args */
function fmt(args) {
  return args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ");
}

/** @param {unknown} v */
function safeJson(v) {
  if (v instanceof Error) return `${v.message}\n${v.stack ?? ""}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const Log = {
  /** @param {keyof typeof LogLevel} name */
  setLevel(name) {
    level = LogLevel[name];
  },
  get isDebug() {
    return level >= LogLevel.debug;
  },
  /** @param {...unknown} args */
  error(...args) {
    console.error(`[MB][ERROR] ${fmt(args)}`);
  },
  /** @param {...unknown} args */
  warn(...args) {
    if (level >= LogLevel.warn) console.warn(`[MB][WARN] ${fmt(args)}`);
  },
  /** @param {...unknown} args */
  info(...args) {
    if (level >= LogLevel.info) console.log(`[MB][INFO] ${fmt(args)}`);
  },
  /** @param {...unknown} args */
  debug(...args) {
    if (level >= LogLevel.debug) console.log(`[MB][DEBUG] ${fmt(args)}`);
  },
};
