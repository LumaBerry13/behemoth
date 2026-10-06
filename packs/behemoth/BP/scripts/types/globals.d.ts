// The Bedrock script runtime provides a console; lib "ES2022" does not declare one.
declare const console: {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
