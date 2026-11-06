// @ts-check
/**
 * Renders ```mermaid fences to inline SVG at build time with Pele
 * (https://pele.run). Colors and fonts come from CSS variables, so one SVG
 * serves both themes; `.diagram` in src/styles/docs.css maps them to tokens.
 *
 * Fence meta: `title="..."` becomes the figure caption and the SVG's label.
 *
 * Wide flowcharts also get a version laid out for a phone column (Pele flips
 * the direction when `maxWidth` is small); CSS shows it under a container
 * query. Anything else scrolls sideways once it would shrink below
 * MIN_SCALE. The Mermaid source rides along in a hidden <pre> so
 * llms.txt keeps a readable copy of every diagram. Search indexes only the
 * caption.
 */
import { createHash } from "node:crypto";
import { render } from "pele";
import { defineMdastPlugin } from "satteri";

/** Matches Starlight's content column (--sl-content-width: 46rem). */
const WIDE = 736;
/** A 390px phone minus the 16px gutters. */
const NARROW = 358;
/** A phone version a little wider than the column still reads fine scaled. */
const NARROW_SLACK = 100;
/** Smallest scale a wide drawing shrinks to before it scrolls. */
const MIN_SCALE = 0.7;

const FONT = "Archivo Variable";
const MONO = "JetBrains Mono Variable";

/** @param {string} value */
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * MDX parses raw HTML as Markdown and applies smart punctuation to its text,
 * which would turn `-->` into `–>`. Numeric entities survive that pass.
 */
const LITERAL_CHARS = /[&<>"'.-]/g;

/** @param {string} value */
const escapeLiteral = (value) =>
  value.replace(LITERAL_CHARS, (char) => `&#${char.charCodeAt(0)};`);

const TITLE_META = /title="([^"]*)"/;

/** @param {string | null | undefined} meta */
const titleFrom = (meta) => meta?.match(TITLE_META)?.[1];

/**
 * @param {string} source
 * @param {string} idPrefix
 * @param {number} maxWidth
 */
const draw = (source, idPrefix, maxWidth) =>
  render(source, {
    idPrefix,
    maxWidth,
    fontFamily: FONT,
    fontFamilyMono: MONO,
  });

/**
 * @param {string} svg
 * @param {string | undefined} title
 */
const label = (svg, title) =>
  title ? svg.replace("<svg ", `<svg aria-label="${escapeHtml(title)}" `) : svg;

/** @param {string} source @param {string | undefined} title */
export function renderDiagram(source, title) {
  const id = `d${createHash("sha1").update(source).digest("hex").slice(0, 8)}`;
  const wide = draw(source, `${id}w`, WIDE);
  // Below this width the wide drawing stops shrinking and scrolls instead,
  // so its labels stay readable (about 11px).
  const minWidth = Math.round(wide.width * MIN_SCALE);
  let narrowHtml = "";
  // Only flowcharts re-flow well; sequence diagrams break words instead.
  if (wide.width > NARROW && wide.type === "flowchart") {
    const narrow = draw(source, `${id}n`, NARROW);
    if (narrow.width <= NARROW + NARROW_SLACK) {
      narrowHtml = `<div class="diagram-narrow" data-pagefind-ignore="all">${label(narrow.svg, title)}</div>`;
    }
  }
  // On a phone this drawing scrolls sideways; CSS fades its right edge.
  const scrolls = !narrowHtml && minWidth > NARROW;

  // A scrolling region must be focusable so keyboard users can scroll it.
  const region = scrolls
    ? ` diagram-scrolls" tabindex="0" role="region" aria-label="${escapeHtml(title ?? "Diagram")}`
    : "";
  const html = `<div class="diagram-wide${region}" style="--diagram-min: ${minWidth}px" data-pagefind-ignore="all">${label(wide.svg, title)}</div>${narrowHtml}`;

  const caption = title ? `<figcaption>${escapeHtml(title)}</figcaption>` : "";
  const sourceCopy = `<pre class="diagram-source" hidden data-pagefind-ignore="all"><code class="language-mermaid">${escapeLiteral(source)}</code></pre>`;
  return `<figure class="diagram not-content" data-diagram="${wide.type}">${html}${caption}${sourceCopy}</figure>`;
}

export const mermaidDiagrams = defineMdastPlugin({
  name: "gambi-mermaid",
  code(node, ctx) {
    if (node.lang !== "mermaid") {
      return;
    }
    ctx.replaceNode(node, {
      rawHtml: renderDiagram(node.value, titleFrom(node.meta)),
    });
  },
});
