/**
 * Fails when the English and Portuguese docs drift apart:
 * - every page under src/content/docs has a twin under src/content/docs/pt-br,
 *   and the other way round;
 * - src/content/i18n/en.json and pt-BR.json hold the same keys.
 *
 * Run with `bun run check:i18n` from apps/docs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const docs = join(root, "src/content/docs");
const ptDir = join(docs, "pt-br");
const PAGE = /\.(md|mdx|mdoc)$/;

const pagesUnder = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => PAGE.test(file))
    .map((file) => relative(dir, join(dir, file)));

const english = new Set(
  pagesUnder(docs).filter((page) => !page.startsWith("pt-br/"))
);
const portuguese = new Set(pagesUnder(ptDir));

const problems: string[] = [];
for (const page of english) {
  if (!portuguese.has(page)) {
    problems.push(`missing Portuguese page: src/content/docs/pt-br/${page}`);
  }
}
for (const page of portuguese) {
  if (!english.has(page)) {
    problems.push(`Portuguese page without an English source: pt-br/${page}`);
  }
}

const keys = (file: string) =>
  new Set(
    Object.keys(
      JSON.parse(readFileSync(join(root, "src/content/i18n", file), "utf8"))
    )
  );
const en = keys("en.json");
const pt = keys("pt-BR.json");
for (const key of en) {
  if (!pt.has(key)) {
    problems.push(`key missing from pt-BR.json: ${key}`);
  }
}
for (const key of pt) {
  if (!en.has(key)) {
    problems.push(`key missing from en.json: ${key}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(
    "\nSee docs/reference/docs-update.md (Localization) for how to fix these."
  );
  process.exit(1);
}
console.log(
  `i18n ok: ${english.size} pages and ${en.size} UI strings in both languages.`
);
