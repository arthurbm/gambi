#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { build } from "bun";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

// 1. Limpar dist/
await rm("./dist", { recursive: true, force: true });
console.log("✓ Cleaned dist/");

// 2. Apenas 1 entrypoint para evitar bug de duplicate exports do bun
// O client é re-exportado pelo index, então não precisa de entrypoint separado
const entrypoints = ["./src/index.ts"];

const sharedOptions = {
  target: "node" as const,
  format: "esm" as const,
  sourcemap: "external" as const,
  minify: false,
  external: ["ai", "@ai-sdk/provider"],
};

// 3. Build principal com bun (gera .js)
const result = await build({
  entrypoints,
  outdir: "./dist",
  splitting: true, // Funciona bem com poucos entrypoints
  ...sharedOptions,
});

if (!result.success) {
  console.error("✗ Build failed");
  process.exit(1);
}

console.log(`✓ Built ${result.outputs.length} files`);

// 4. Build separado para subpath export gambi-sdk/discovery
// Não pode ser adicionado como segundo entrypoint ao build principal
// porque o index re-exporta discovery, o que aciona o bug de duplicate exports do bun
const discoveryResult = await build({
  entrypoints: ["./src/discovery.ts"],
  outdir: "./dist",
  splitting: false,
  ...sharedOptions,
});

if (!discoveryResult.success) {
  console.error("✗ Discovery subpath build failed");
  process.exit(1);
}

console.log(
  `✓ Built discovery subpath (${discoveryResult.outputs.length} files)`
);

// 5. Gerar .d.ts empacotados com rollup-plugin-dts
// O @gambi/core não é publicado: as declarações dele entram no bundle, como o
// JS acima. Os demais pacotes ficam externos e precisam estar em dependencies.
// Ver issue #82 e scripts/check-packed-types.ts.
const isBundledIntoDeclarations = (id: string) =>
  id.startsWith(".") || isAbsolute(id) || id.startsWith("@gambi/");

const declarations = await rollup({
  input: { index: "./src/index.ts", discovery: "./src/discovery.ts" },
  plugins: [dts({ respectExternal: true, tsconfig: "./tsconfig.json" })],
  external: (id) => !isBundledIntoDeclarations(id),
});
await declarations.write({ dir: "./dist", format: "es" });
await declarations.close();
console.log("✓ Generated bundled type declarations");

console.log("✓ Build completed successfully");
