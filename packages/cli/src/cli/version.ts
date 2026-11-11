/**
 * The version of this CLI. The release build injects `GAMBI_CLI_VERSION`
 * (`packages/cli/build.ts`); from source it is the workspace version.
 */
import packageJson from "../../package.json" with { type: "json" };

export const CLI_VERSION: string =
  process.env.GAMBI_CLI_VERSION ?? packageJson.version;
