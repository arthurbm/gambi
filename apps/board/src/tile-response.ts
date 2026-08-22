export const TILE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "connect-src https://cdn.jsdelivr.net",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "worker-src blob:",
  "sandbox allow-scripts",
].join("; ");

const HEAD_START_PATTERN = /<head(?:\s[^>]*)?>/i;

function safeJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function injectTileStatusBridge(input: {
  tileId: string;
  squadId: string;
  boardVersion: number;
  indexHtml: string;
}) {
  const identity = safeJson({
    tileId: input.tileId,
    squadId: input.squadId,
    boardVersion: input.boardVersion,
  });
  const bridge = `<script data-gambi-tile-bridge>
(() => {
  const identity = ${identity};
  const report = (status, detail) => parent.postMessage({ type: "gambi.tile.status", status, ...identity, detail }, "*");
  addEventListener("error", (event) => report("error", String(event.message || "Tile script failed")));
  addEventListener("unhandledrejection", (event) => report("error", String(event.reason || "Tile promise rejected")));
  addEventListener("load", () => report("ready"), { once: true });
})();
</script>`;
  const headStart = HEAD_START_PATTERN.exec(input.indexHtml);
  if (headStart?.index !== undefined) {
    const insertionPoint = headStart.index + headStart[0].length;
    return `${input.indexHtml.slice(0, insertionPoint)}${bridge}${input.indexHtml.slice(insertionPoint)}`;
  }
  return `${bridge}${input.indexHtml}`;
}
