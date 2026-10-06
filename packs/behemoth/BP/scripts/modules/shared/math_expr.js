// Small, safe arithmetic evaluator for variableMath (no eval / Function).
// Grammar: numbers, the variable `x`, + - * / % ^ (power, right-assoc),
// unary minus, parentheses, and the functions
//   min(a,b,..) max(a,b,..) abs floor ceil round sqrt sin cos tan pow(a,b) clamp(v,lo,hi)
// (trig in degrees, like MythicMobs). Parsed expressions are cached by text.

/** @typedef {(x: number) => number} Compiled */

const FUNCS = {
  min: (...a) => Math.min(...a),
  max: (...a) => Math.max(...a),
  abs: (a) => Math.abs(a),
  floor: (a) => Math.floor(a),
  ceil: (a) => Math.ceil(a),
  round: (a) => Math.round(a),
  sqrt: (a) => Math.sqrt(a),
  sin: (a) => Math.sin((a * Math.PI) / 180),
  cos: (a) => Math.cos((a * Math.PI) / 180),
  tan: (a) => Math.tan((a * Math.PI) / 180),
  pow: (a, b) => a ** b,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
};

/** @type {Map<string, Compiled>} */
const cache = new Map();
const CACHE_MAX = 256;

/**
 * Compile an expression; throws Error with a readable message on bad input.
 * @param {string} text @returns {Compiled}
 */
export function compileExpr(text) {
  const hit = cache.get(text);
  if (hit) return hit;
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  const expect = (t) => {
    if (tokens[i] !== t) throw new Error(`expected "${t}" in "${text}"`);
    i++;
  };

  /** @returns {Compiled} */
  function expr() {
    let left = term();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const l = left, r = term();
      left = op === "+" ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  }
  /** @returns {Compiled} */
  function term() {
    let left = power();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const l = left, r = power();
      left = op === "*" ? (x) => l(x) * r(x) : op === "/" ? (x) => l(x) / r(x) : (x) => l(x) % r(x);
    }
    return left;
  }
  /** @returns {Compiled} */
  function power() {
    const base = unary();
    if (peek() === "^") {
      take();
      const exp = power();
      return (x) => base(x) ** exp(x);
    }
    return base;
  }
  /** @returns {Compiled} */
  function unary() {
    if (peek() === "-") {
      take();
      const v = unary();
      return (x) => -v(x);
    }
    if (peek() === "+") take();
    return atom();
  }
  /** @returns {Compiled} */
  function atom() {
    const t = take();
    if (t === undefined) throw new Error(`unexpected end of "${text}"`);
    if (t === "(") {
      const v = expr();
      expect(")");
      return v;
    }
    if (/^[\d.]/.test(t)) {
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error(`bad number "${t}"`);
      return () => n;
    }
    if (t === "x") return (x) => x;
    const fn = FUNCS[/** @type {keyof typeof FUNCS} */ (t.toLowerCase())];
    if (!fn) throw new Error(`unknown name "${t}" in "${text}"`);
    expect("(");
    /** @type {Compiled[]} */
    const args = [];
    if (peek() !== ")") {
      args.push(expr());
      while (peek() === ",") {
        take();
        args.push(expr());
      }
    }
    expect(")");
    return (x) => fn(...args.map((a) => a(x)));
  }

  const out = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}" in "${text}"`);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(text, out);
  return out;
}

/** @param {string} text */
function tokenize(text) {
  const out = [];
  const re = /\s*(\d+\.?\d*|\.\d+|[A-Za-z_]\w*|[-+*/%^(),])/y;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) throw new Error(`cannot read "${text.slice(pos)}"`);
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}
