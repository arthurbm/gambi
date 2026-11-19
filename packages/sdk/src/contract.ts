/**
 * Where the SDK meets the management contract (`@gambi/protocol`). The public
 * surface is written by hand (`types.ts`, `client-error.ts`, the interfaces of
 * `client.ts`) so that no Effect type reaches a consumer; this file is what
 * keeps the two from drifting apart:
 *
 * - `ManagementPlane` is the client derived from the contract, for one hub;
 * - `translated` turns every failure of that client into a `ClientError`;
 * - `ContractProofs` fails the type check when a public type stops being the
 *   type of its schema.
 *
 * Internal: nothing here is exported from an entry of the SDK.
 */
import {
  type HarnessAttachEvent as ContractHarnessAttachEvent,
  type HarnessSessionRef as ContractHarnessSessionRef,
  type ParticipantLeft as ContractParticipantLeft,
  type ParticipantRegistered as ContractParticipantRegistered,
  type ParticipantSummary as ContractParticipantSummary,
  type RoomCreated as ContractRoomCreated,
  type RoomEvent as ContractRoomEvent,
  type RoomSummary as ContractRoomSummary,
  type CreateRoom,
  HarnessFailed,
  HarnessSessionNotOpen,
  HarnessSessionOutsideWorkspace,
  type Health,
  InternalError,
  InvalidPassword,
  InvalidRequest,
  invalidManagementInput,
  isConnectionFailure,
  type ManagementClient,
  makeManagementClient,
  NotAHarnessParticipant,
  type OpenHarnessSession,
  ParticipantNotFound,
  ParticipantOfAnotherRuntime,
  ParticipantUnreachable,
  type RegisterParticipant,
  RoomNotFound,
  VersionMismatch,
  withRequestProgress,
} from "@gambi/protocol";
import { Context, type Effect, Layer, Schema } from "effect";
import type { Sse } from "effect/encoding";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { ClientError, type ClientErrorCode } from "./client-error.ts";
import type {
  CreateRoomInput,
  HarnessAttachEvent,
  HarnessSessionRef,
  HubHealth,
  OpenHarnessSessionInput,
  ParticipantLeft,
  ParticipantRegistered,
  ParticipantSummary,
  RegisterParticipantInput,
  RoomCreated,
  RoomEvent,
  RoomSummary,
} from "./types.ts";

/**
 * The management plane of one hub, as a client sees it: the client derived
 * from the contract. It calls the hub with `fetch`, so it runs wherever
 * `fetch` does.
 */
export class ManagementPlane extends Context.Service<
  ManagementPlane,
  ManagementClient
>()("gambi/sdk/ManagementPlane") {
  /** The management plane of the hub at `hubUrl` (without `/v1`). */
  static readonly layer = (hubUrl: string): Layer.Layer<ManagementPlane> =>
    Layer.effect(ManagementPlane, makeManagementClient(hubUrl)).pipe(
      Layer.provide(FetchHttpClient.layer)
    );
}

/**
 * The errors a hub answers in its envelope, by tag. An error added to an
 * endpoint of the contract does not compile in `client.ts` until its class is
 * here and its code is in `ClientErrorCode`.
 */
const hubErrors = {
  HarnessFailed,
  HarnessSessionNotOpen,
  HarnessSessionOutsideWorkspace,
  InternalError,
  InvalidPassword,
  InvalidRequest,
  NotAHarnessParticipant,
  ParticipantNotFound,
  ParticipantOfAnotherRuntime,
  ParticipantUnreachable,
  RoomNotFound,
  VersionMismatch,
};

type HubError = InstanceType<(typeof hubErrors)[keyof typeof hubErrors]>;

/**
 * Everything the derived client can fail with: a call, or a stream of events
 * (the last two, which come from its SSE parser).
 */
export type ManagementFailure =
  | HubError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | Sse.SseError
  | Sse.Retry;

/** The structured fields of a hub error, without what `ClientError` already names. */
const detailsOf = (error: HubError): Record<string, unknown> => {
  const { _tag, requestId, ...fields } = hubErrors[error._tag].fields;
  const values: Record<string, unknown> = { ...error };
  return Object.fromEntries(
    Object.keys(fields).map((field) => [field, values[field]])
  );
};

const fromHubError = (error: HubError): ClientError => {
  const errorClass = hubErrors[error._tag];
  const code: ClientErrorCode = errorClass.code;
  return new ClientError({
    code,
    details: detailsOf(error),
    hint: "hint" in error ? error.hint : undefined,
    message: error.message,
    requestId: error.requestId,
    status: errorClass.status,
  });
};

/**
 * The `ROOM_NOT_FOUND` of a route outside the management contract. The
 * inference plane names the same failure in the OpenAI error format, and a
 * consumer catches one error whichever plane the SDK asked.
 */
export const roomNotFound = (roomCode: string): ClientError =>
  fromHubError(new RoomNotFound({ roomCode }));

export const hubUnreachable = (hubUrl: string, cause: unknown): ClientError =>
  new ClientError({
    cause,
    code: "HUB_UNREACHABLE",
    details: { hubUrl },
    hint: "Check that the hub is running and that the hub URL points at it.",
    message: `Could not reach a hub at ${hubUrl}.`,
  });

export const notAHub = (
  hubUrl: string,
  cause: unknown,
  status?: number
): ClientError =>
  new ClientError({
    cause,
    code: "NOT_A_HUB",
    details: { hubUrl },
    hint: "Check that the hub URL points at a Gambi hub of the same version as this SDK.",
    message: `The server at ${hubUrl} did not answer like a Gambi hub${
      status === undefined ? "" : ` (HTTP ${status})`
    }.`,
    status,
  });

const invalidInput = (failure: Schema.SchemaError): ClientError => {
  const refused = invalidManagementInput(failure);
  return new ClientError({
    cause: failure,
    code: InvalidRequest.code,
    details: { issues: refused.issues },
    hint: refused.hint,
    message: refused.message,
  });
};

/**
 * Turns a failure of the derived client into the error a consumer catches.
 * An error of the contract keeps its code, message, hint and fields; a
 * transport failure becomes `HUB_UNREACHABLE` and an answer outside the
 * contract becomes `NOT_A_HUB`. `sent` says whether the request had gone out.
 */
const toClientError = (
  hubUrl: string,
  failure: ManagementFailure,
  sent: boolean
): ClientError => {
  if (HttpClientError.isHttpClientError(failure)) {
    const reason = failure.reason;
    if (isConnectionFailure(failure)) {
      return hubUnreachable(hubUrl, failure);
    }
    // An undeclared status arrives as `DecodeError`, not as `StatusCodeError`.
    return notAHub(
      hubUrl,
      failure,
      "response" in reason ? reason.response.status : undefined
    );
  }
  if (Schema.isSchemaError(failure)) {
    return sent ? notAHub(hubUrl, failure) : invalidInput(failure);
  }
  // Events that do not parse, or a retry directive, which a hub never sends.
  if (failure._tag === "SseError" || failure._tag === "Retry") {
    return notAHub(hubUrl, failure);
  }
  return fromHubError(failure);
};

/**
 * One call of the derived client to the hub at `hubUrl`, failing with the
 * `ClientError` a consumer catches.
 */
export const translated =
  (hubUrl: string) =>
  <A, R>(
    call: Effect.Effect<A, ManagementFailure, R>
  ): Effect.Effect<A, ClientError, R> =>
    withRequestProgress(call, (failure, sent) =>
      toClientError(hubUrl, failure, sent)
    );

/** A failure in the middle of a stream of events the hub was already sending. */
export const translatedMidStream =
  (hubUrl: string) =>
  (failure: ManagementFailure): ClientError =>
    toClientError(hubUrl, failure, true);

/**
 * `true` only when `Public` and `Contract` are assignable to each other and
 * name the same keys. The keys are compared too because an optional key that
 * one side lacks leaves the two assignable: that is how `harness` once went
 * missing from the public `ParticipantSummary` without a line failing.
 */
export type Same<Public, Contract> = [Public] extends [Contract]
  ? [Contract] extends [Public]
    ? [keyof Public] extends [keyof Contract]
      ? [keyof Contract] extends [keyof Public]
        ? true
        : false
      : false
    : false
  : false;

export type Assert<Proof extends true> = Proof;

/**
 * One line per public type that mirrors a schema of the contract. When the
 * contract changes, the line of the type that fell behind stops compiling.
 * A type added to `types.ts` for a new group of the contract gets a line.
 */
export type ContractProofs = [
  Assert<Same<HubHealth, Health>>,
  Assert<Same<RoomSummary, ContractRoomSummary>>,
  Assert<Same<CreateRoomInput, CreateRoom>>,
  Assert<Same<RoomCreated, ContractRoomCreated>>,
  Assert<Same<ParticipantSummary, ContractParticipantSummary>>,
  Assert<
    Same<
      RegisterParticipantInput & { readonly version: string },
      Omit<RegisterParticipant, "authHeaders">
    >
  >,
  Assert<Same<ParticipantRegistered, ContractParticipantRegistered>>,
  Assert<Same<ParticipantLeft, ContractParticipantLeft>>,
  Assert<Same<RoomEvent, ContractRoomEvent>>,
  Assert<Same<HarnessAttachEvent, ContractHarnessAttachEvent>>,
  Assert<Same<OpenHarnessSessionInput, OpenHarnessSession>>,
  Assert<Same<HarnessSessionRef, ContractHarnessSessionRef>>,
];
