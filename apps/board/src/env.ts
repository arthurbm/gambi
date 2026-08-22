import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_BOARD_DATABASE_URL = `file:${fileURLToPath(
  new URL("../data/board.db", import.meta.url)
)}`;

const envSchema = z.object({
  BOARD_ADMIN_TOKEN: z.string().min(8).default("gambi-local-admin"),
  BOARD_DATABASE_URL: z.string().default(DEFAULT_BOARD_DATABASE_URL),
  BOARD_HOST: z.string().default("0.0.0.0"),
  BOARD_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
});

export function readBoardEnv(
  source: Record<string, string | undefined> = process.env
) {
  return envSchema.parse(source);
}
