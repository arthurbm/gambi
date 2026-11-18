/**
 * The first import of an entry that hosts something. Hosting uses Bun's own
 * server, sockets and subprocesses, so such an entry says it at once when it
 * is loaded anywhere else, instead of failing later on a missing built-in.
 *
 * Internal. Importing it is the check.
 */
if (typeof globalThis.Bun === "undefined") {
  throw new Error(
    "This entry of gambi-sdk hosts a hub or a participant in the current process, which only runs in Bun (https://bun.sh). In Node, use the default entry (`gambi-sdk`): its client reaches a hub that runs elsewhere."
  );
}

// Makes this file a module. As a script, its statements would be copied into
// the bundled declarations of the entries.
export {};
