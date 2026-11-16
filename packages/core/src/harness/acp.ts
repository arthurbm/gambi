/**
 * The part of ACP v1 the participant runtime itself speaks: three calls,
 * typed by hand (ADR-0007). Everything else a harness and its clients say to
 * each other is relayed without being read.
 *
 * ACP stays pinned to v1 (ADR-0006): `ACP_VERSION` is the only version the
 * runtime offers and the only one it accepts back.
 */
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { Schema } from "effect";

/** The ACP protocol version: `1`. */
export const ACP_VERSION = PROTOCOL_VERSION;

/** One call the runtime makes to the harness: its method, and the schemas of what goes and what comes back. */
export interface AcpCall<
  Params extends Schema.Top = Schema.Top,
  Result extends Schema.Top = Schema.Top,
> {
  readonly method: string;
  readonly params: Params;
  readonly result: Result;
}

/** `initialize`: the first call. The harness answers the version it agreed to. */
export const Initialize = {
  method: "initialize",
  params: Schema.Struct({
    protocolVersion: Schema.Number,
    clientCapabilities: Schema.Struct({}),
    clientInfo: Schema.Struct({ name: Schema.String, version: Schema.String }),
  }),
  result: Schema.Struct({ protocolVersion: Schema.Number }),
} satisfies AcpCall;

/** `session/new`: opens a session in a folder. The harness names it. */
export const NewSession = {
  method: "session/new",
  params: Schema.Struct({
    cwd: Schema.String,
    mcpServers: Schema.Array(Schema.Unknown),
  }),
  result: Schema.Struct({ sessionId: Schema.NonEmptyString }),
} satisfies AcpCall;

/** `session/close`: closes a session. The answer carries nothing the runtime reads. */
export const CloseSession = {
  method: "session/close",
  params: Schema.Struct({ sessionId: Schema.String }),
  result: Schema.Unknown,
} satisfies AcpCall;

/** The id of a JSON-RPC message. */
export const JsonRpcId = Schema.Union([Schema.String, Schema.Number]);
export type JsonRpcId = typeof JsonRpcId.Type;

/** What the runtime reads of the answer to one of its own calls. */
export const JsonRpcAnswer = Schema.Struct({
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(
    Schema.Struct({ message: Schema.optionalKey(Schema.String) })
  ),
});

/** One line of the harness's stdout, when it is a JSON object. */
export const JsonLine = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Unknown)
);
