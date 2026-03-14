// Workaround for Bun bundler bug: Clipanion's ESM barrel export of `String`
// collides with the global `String` during `bun build --compile`.
// Using require() instead of import bypasses the ESM re-export resolution.
// See: https://github.com/oven-sh/bun/issues — Bun bundler String collision
const clipanion = require("clipanion");

export const Command: typeof import("clipanion").Command = clipanion.Command;
export const Option: typeof import("clipanion").Option = clipanion.Option;
export const Builtins: typeof import("clipanion").Builtins = clipanion.Builtins;
export const Cli: typeof import("clipanion").Cli = clipanion.Cli;
