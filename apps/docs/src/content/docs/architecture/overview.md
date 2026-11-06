---
title: Architecture overview
description: How Gambi works under the hood and why the system is split into public HTTP surfaces and participant tunnels.
---

Gambi exposes an HTTP management plane, an OpenAI-compatible HTTP inference plane, and a participant tunnel between the hub and each registered participant.

## System diagram

```mermaid title="Clients call the hub over HTTP. Participants open the tunnel; the hub never dials out."
flowchart LR
  ops["SDK and CLI"]
  apps["Apps and AI tools"]
  subgraph hub["Hub"]
    mgmt["Management API<br/>/v1/* and SSE events"]
    inf["Inference API<br/>/rooms/:code/v1/*"]
    reg["Tunnel registry<br/>and routing"]
  end
  subgraph machine["Participant machine"]
    rt["Participant runtime"]
    prov[("Model endpoint")]:::model
    har["Harness, ACP v1"]:::harness
  end
  ops -->|HTTP| mgmt
  apps -->|HTTP| inf
  rt ==>|opens WebSocket| reg
  rt --> prov
  rt --> har
  classDef model stroke-width:1.5px
  classDef harness stroke-width:1.5px
```

## Core idea

Applications talk to Gambi over standard HTTP, so OpenAI-style tools and SDKs work unchanged.

Participants do not publish a network-reachable provider endpoint. The participant runtime opens a tunnel to the hub and forwards inference requests to its local or remote provider. A harness participant uses the same tunnel to relay ACP v1 messages for a harness process on its machine.

## Registration flow

1. The participant runtime probes its provider endpoint locally. A harness participant checks that the harness is installed and logged in instead.
2. It registers with `PUT /v1/rooms/:code/participants/:id`.
3. The hub returns `{ participant, roomId, tunnel }`.
4. The runtime opens `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
5. The hub upgrades the connection and starts forwarding tunnel requests.
6. The runtime keeps sending management heartbeats.

## Request flow

1. An application sends `POST /rooms/:code/v1/responses` or `POST /rooms/:code/v1/chat/completions`.
2. The hub picks a participant by participant ID, `model:<name>`, or `*`. See [Model routing](/reference/api/#model-routing).
3. The hub forwards the request through the participant tunnel.
4. The participant runtime forwards it to the real provider endpoint.
5. The runtime streams the provider response back through the tunnel.
6. The hub returns the response to the application client.

```mermaid title="One inference request. Provider credentials are applied on the participant machine."
sequenceDiagram
  participant App as Your app
  participant Hub
  participant RT as Participant runtime
  participant P as Provider
  App->>Hub: POST /rooms/:code/v1/responses
  Note over Hub: route by participant id, model:<name>, or *
  Hub->>RT: tunnel.request
  RT->>P: HTTP request with its own auth headers
  P-->>RT: response stream
  RT-->>Hub: tunnel.response.start / chunk / end
  Hub-->>App: response stream
```

## Why the split

### HTTP for apps

- standard OpenAI-compatible interface
- works with existing SDKs and tools
- debuggable with ordinary HTTP tools

### WebSocket for participant transport

- lets providers stay on `localhost`
- keeps provider credentials on the participant runtime
- avoids asking participants to publish network endpoints just to join a room
- carries opaque ACP v1 messages and artifacts for harness participants
- lets management clients attach through the hub without the hub initiating any connection to the participant

### SSE for observability

- one-way room event stream is enough for monitoring
- powers the TUI and operational clients
- keeps operational visibility separate from inference transport

Optional applications can build coordination above these contracts with
`gambi-sdk`: attach to harness participants, host their own, and keep their own
state. Their streams are not the hub room stream and do not change the public
hub API.

## Routing rules

The `model` field of an inference request selects the participant: a participant ID, `model:<name>`, or `*`. A participant is available only when its tunnel is connected, it is not offline, and it is not handling another request. Harness participants are never selected. The [API reference](/reference/api/#model-routing) has the full rules, including the fallback for an unknown participant ID.

## Tunnel protocol

The tunnel is a WebSocket between the hub and the participant runtime. Messages are JSON objects with a `type` field.

Hub to participant:

- `tunnel.request`: a forwarded inference request. Includes `requestId`, `operation`, HTTP `method`, `path`, `headers`, `body`, a `stream` flag, and optional `metadata`.
- `tunnel.pong`: reply to a participant ping.
- `tunnel.harness.message`: opaque ACP JSON-RPC for a `sessionId`.
- `tunnel.harness.control`: open or close a harness session.

Participant to hub:

- `tunnel.response.start`: response headers and HTTP status for `requestId`.
- `tunnel.response.chunk`: one streamed body chunk for `requestId`.
- `tunnel.response.end`: the response body is complete.
- `tunnel.response.error`: the participant runtime failed to produce a response. Includes a `stage` label and a human-readable `message`.
- `tunnel.ping`: keepalive from the participant.
- `tunnel.harness.message`: opaque ACP JSON-RPC response or update.
- `tunnel.harness.artifact`: versioned workspace files.
- `tunnel.harness.status`: opened, closed, or error state.

The management attach route sends harness output to every attached client. An attached client socket is independent of the participant tunnel. If the tunnel closes and the participant opens a new one, attached clients keep their sockets and do not need to reattach.

See `packages/core/src/tunnel-protocol.ts` for the authoritative schemas.

## Protocol adaptation between Responses and Chat Completions

The default protocol is Responses. Chat Completions remains available for compatibility.

When the client and the participant do not speak the same protocol, the hub adapts between them. Two consequences:

- a client using Responses can reach a participant that only exposes Chat Completions, and vice versa
- the adapter focuses on the message-level contract; stateful Responses features such as `previous_response_id`, `store`, and `background` may be limited or unsupported when the underlying participant is a Chat Completions endpoint

New integrations should prefer Responses. Fall back to Chat Completions only when you need explicit compatibility with an existing tool.

## Health timings

Participant runtimes send a management heartbeat and a tunnel ping every 10 seconds. After 30 seconds without a heartbeat the hub marks the participant offline, and after 30 seconds without a tunnel frame it closes the tunnel. The [API reference](/reference/api/#health-timings) lists the constants.

## Observability

The hub emits `llm.request`, `llm.complete`, and `llm.error` for inference, and `harness.session.opened`, `harness.session.closed`, and `harness.artifact` for harness participants. `llm.complete` carries timing and token metrics. See [Observability](/reference/observability/) for the fields.

## What Gambi does not do

- It does not host models.
- The hub has no built-in authentication. Run it on a trusted network, or behind your own proxy and authentication layer.
- The hub does not orchestrate models or harnesses. Applications can coordinate work through the SDK without moving that policy into the hub.

For where coordination above the hub is being explored, see [What's next](/explanation/whats-next/).
