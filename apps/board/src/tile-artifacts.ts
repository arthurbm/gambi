import { createHash } from "node:crypto";
import type { HarnessArtifactFile } from "@gambi/agents";
import { z } from "zod";

export const TILE_FILE_MAX_BYTES = 512 * 1024;
export const TILE_TOTAL_MAX_BYTES = 1024 * 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const tileManifestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(280),
  station: z
    .object({
      name: z.string().trim().min(1).max(80),
      x: z.number().finite().min(-4.5).max(4.5),
      z: z.number().finite().min(-4.5).max(4.5),
    })
    .nullable(),
  palette: z.object({
    sky: z.string().regex(HEX_COLOR),
    ground: z.string().regex(HEX_COLOR),
    accent: z.string().regex(HEX_COLOR),
  }),
});

export type TileManifest = z.infer<typeof tileManifestSchema>;

export interface PreparedTileArtifact {
  fingerprint: string;
  indexHtml: string | null;
  manifest: TileManifest | null;
  manifestJson: string | null;
  readme: string | null;
  valid: boolean;
  validationError: string | null;
}

function decodeFile(file: HarnessArtifactFile) {
  if (file.encoding === "base64") {
    return Buffer.from(file.content, "base64").toString("utf8");
  }
  return file.content;
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

export function prepareTileArtifact(
  files: HarnessArtifactFile[]
): PreparedTileArtifact {
  const normalized = [...files]
    .map((file) => ({ ...file, path: file.path.replaceAll("\\", "/") }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
  const required = new Map<string, string>();
  const errors: string[] = [];

  for (const filename of ["manifest.json", "index.html", "README.md"]) {
    const matches = normalized.filter((file) => file.path === filename);
    if (matches.length === 0) {
      errors.push(`${filename} não foi enviado.`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`${filename} foi enviado mais de uma vez.`);
      continue;
    }
    const content = decodeFile(matches[0] as HarnessArtifactFile);
    if (byteLength(content) > TILE_FILE_MAX_BYTES) {
      errors.push(`${filename} excede 512 KiB.`);
      continue;
    }
    required.set(filename, content);
  }

  const totalBytes = [...required.values()].reduce(
    (total, value) => total + byteLength(value),
    0
  );
  if (totalBytes > TILE_TOTAL_MAX_BYTES) {
    errors.push("O tile excede 1 MiB no total.");
  }

  const rawManifest = required.get("manifest.json") ?? null;
  let manifest: TileManifest | null = null;
  if (rawManifest) {
    try {
      manifest = tileManifestSchema.parse(JSON.parse(rawManifest));
    } catch {
      errors.push("manifest.json não segue o contrato do starter.");
    }
  }

  return {
    fingerprint,
    indexHtml: required.get("index.html") ?? null,
    manifest,
    manifestJson: manifest ? JSON.stringify(manifest) : rawManifest,
    readme: required.get("README.md") ?? null,
    valid: errors.length === 0,
    validationError: errors.length > 0 ? errors.join(" ") : null,
  };
}
