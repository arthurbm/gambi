/**
 * How a command reaches a hub: the `--hub` flag and `withHub`, which hands
 * the client derived from the management contract to the command and names
 * the two ways the other end can fail to be a hub.
 */
import { type ManagementClient, makeManagementClient } from "@gambi/protocol";
import { Config, Effect, Schema } from "effect";
import { Flag } from "effect/cli";
import { type HttpClient, HttpClientError } from "effect/http";

export const DEFAULT_HUB_URL = "http://localhost:3000";

const HubUrl = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[^\s/]+/, {
    message: "Expected an http:// or https:// URL",
  })
);

/** The environment variable that says where the hub is when `--hub` does not. */
export const HUB_URL_VARIABLE = "GAMBI_HUB";

/**
 * `--hub`, `-H`: shared by every command that talks to a hub. Without the
 * flag the URL is `GAMBI_HUB`, and without that the hub of this machine.
 */
export const hubFlag = Flag.String("hub").pipe(
  Flag.withAlias("H"),
  Flag.withMetavar("url"),
  Flag.withDescription(
    `URL of the hub. Default: the ${HUB_URL_VARIABLE} variable, then ${DEFAULT_HUB_URL}`
  ),
  Flag.withFallbackConfig(Config.String(HUB_URL_VARIABLE)),
  Flag.withSchema(HubUrl),
  Flag.withDefault(DEFAULT_HUB_URL)
);

/** Nothing answered at the hub URL: wrong address, hub down, or no network. */
export class HubUnreachable extends Schema.TaggedError<HubUnreachable>()(
  "HubUnreachable",
  { hubUrl: Schema.String, cause: Schema.Defect() }
) {
  override get message(): string {
    return `Could not reach a hub at ${this.hubUrl}.`;
  }

  get hint(): string {
    return "Check that the hub is running (`gambi hub serve`) and that --hub, or GAMBI_HUB, points at it.";
  }
}

/**
 * Something answered at the hub URL, but not with what the management
 * contract describes: another server, a proxy, or a hub of another version.
 */
export class NotAHub extends Schema.TaggedError<NotAHub>()("NotAHub", {
  hubUrl: Schema.String,
  /** The HTTP status of the answer, when the status itself was the surprise. */
  status: Schema.optionalKey(Schema.Int),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    const status = this.status === undefined ? "" : ` (HTTP ${this.status})`;
    return `The server at ${this.hubUrl} did not answer like a Gambi hub${status}.`;
  }

  get hint(): string {
    return "Check that --hub points at a Gambi hub of the same version as this CLI.";
  }
}

const fromHttpClientError = (
  hubUrl: string,
  error: HttpClientError.HttpClientError
): HubUnreachable | NotAHub => {
  const reason = error.reason;
  if (reason._tag === "TransportError" || reason._tag === "InvalidUrlError") {
    return new HubUnreachable({ hubUrl, cause: error });
  }
  // An undeclared status arrives as `DecodeError`, not as `StatusCodeError`.
  return "response" in reason
    ? new NotAHub({ hubUrl, status: reason.response.status, cause: error })
    : new NotAHub({ hubUrl, cause: error });
};

/**
 * Names what kept a hub from answering as the management contract says,
 * from the failure behind it: an answer outside the contract is `NotAHub`,
 * and no answer at all is `HubUnreachable`.
 */
export const hubFailure = (
  hubUrl: string,
  cause: unknown
): HubUnreachable | NotAHub => {
  if (HttpClientError.isHttpClientError(cause)) {
    return fromHttpClientError(hubUrl, cause);
  }
  return Schema.isSchemaError(cause)
    ? new NotAHub({ hubUrl, cause })
    : new HubUnreachable({ hubUrl, cause });
};

/**
 * Runs `use` with the management client of the hub at `hubUrl`. The typed
 * errors of the contract pass through unchanged; a transport failure becomes
 * `HubUnreachable` and an answer outside the contract becomes `NotAHub`.
 */
export const withHub = <A, E, R>(
  hubUrl: string,
  use: (
    client: ManagementClient
  ) => Effect.Effect<
    A,
    E | HttpClientError.HttpClientError | Schema.SchemaError,
    R
  >
): Effect.Effect<A, E | HubUnreachable | NotAHub, R | HttpClient.HttpClient> =>
  makeManagementClient(hubUrl).pipe(
    Effect.flatMap(use),
    Effect.mapError((error) =>
      HttpClientError.isHttpClientError(error) || Schema.isSchemaError(error)
        ? hubFailure(hubUrl, error)
        : error
    )
  );
