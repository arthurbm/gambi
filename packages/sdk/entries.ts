/**
 * The entries of `gambi-sdk` and how each one is built. `build.ts` builds
 * them all into `dist/`; a test builds one into a scratch directory.
 *
 * To add an entry: a line in `entries`, an `exports` entry in `package.json`,
 * and its expectations in `scripts/check-packed-types.ts`.
 */
import { isAbsolute, join } from "node:path";
import { build } from "bun";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

export interface Entry {
  /** The subpath of the package: `.` or `./<name>`. */
  readonly exportPath: string;
  /** The file name in `dist/`, without extension: `dist/<name>.js`. */
  readonly name: string;
  /**
   * What the published JavaScript of the entry may take from its runtime:
   *
   * - `anywhere`: no built-in module at all, so nothing ties it to one
   *   runtime: it needs `fetch` and runs in Node and in Bun;
   * - `node`: Node's built-in modules, so it runs in Node and in Bun;
   * - `bun`: also `bun` and `bun:*`, so it only runs in Bun.
   */
  readonly runsOn: "anywhere" | "node" | "bun";
  /** The source file, relative to the package. */
  readonly source: string;
}

/** The package directory: builds work from any working directory. */
const packageDir = import.meta.dir;

export const entries: readonly Entry[] = [
  {
    exportPath: ".",
    name: "index",
    runsOn: "anywhere",
    source: "src/index.ts",
  },
  {
    exportPath: "./discovery",
    name: "discovery",
    runsOn: "node",
    source: "src/discovery.ts",
  },
  {
    exportPath: "./hub",
    name: "hub",
    runsOn: "bun",
    source: "src/hub.ts",
  },
  {
    exportPath: "./participant",
    name: "participant",
    runsOn: "bun",
    source: "src/participant.ts",
  },
];

/**
 * Packages that stay as imports in the published JavaScript, resolved from
 * the consumer's `node_modules`. Everything else is embedded in each entry,
 * including `effect` and the unpublished `@gambi/*` packages.
 */
const EXTERNAL = ["ai", "@ai-sdk/provider"];

/**
 * Builds the JavaScript of one entry into `outdir`, as one file.
 *
 * Each entry is its own build, without code splitting, so that importing one
 * entry never loads the code of another: the default entry must not pull in a
 * server because the hub entry exists.
 */
export const buildEntry = async (
  entry: Entry,
  outdir: string
): Promise<void> => {
  const result = await build({
    entrypoints: [join(packageDir, entry.source)],
    outdir,
    naming: `${entry.name}.js`,
    target: entry.runsOn === "bun" ? "bun" : "node",
    format: "esm",
    sourcemap: "external",
    minify: false,
    splitting: false,
    external: EXTERNAL,
  });
  if (!result.success) {
    throw new AggregateError(
      result.logs,
      `Building the '${entry.name}' entry failed`
    );
  }
};

/**
 * Builds the declarations of every entry into `outdir`.
 *
 * The unpublished `@gambi/*` packages are embedded, like in the JavaScript.
 * Any other package a public type reaches stays as an import in the
 * published `.d.ts`, where the consumer may not have it: that is how a type
 * of Effect would leak. `scripts/check-packed-types.ts` rejects such imports.
 */
export const buildDeclarations = async (outdir: string): Promise<void> => {
  const isEmbedded = (id: string) =>
    id.startsWith(".") || isAbsolute(id) || id.startsWith("@gambi/");
  const declarations = await rollup({
    input: Object.fromEntries(
      entries.map((entry) => [entry.name, join(packageDir, entry.source)])
    ),
    plugins: [
      dts({
        respectExternal: true,
        tsconfig: join(packageDir, "tsconfig.json"),
      }),
    ],
    external: (id) => !isEmbedded(id),
  });
  await declarations.write({ dir: outdir, format: "es" });
  await declarations.close();
};
