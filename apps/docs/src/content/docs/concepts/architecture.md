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

The hub and its participants must run the same minor version of Gambi. A hub refuses a participant from another minor at registration, with a message that names the version it expects.

## Registration flow

1. The participant runtime probes its provider endpoint locally. A harness participant checks that the harness is installed and logged in instead.
2. It registers with `PUT /v1/rooms/:code/participants/:id`.
3. The hub checks the participant's version and the room password, and returns `{ participant, tunnel }` with a single-use token.
4. The runtime opens `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
5. The hub accepts the tunnel, marks the participant `online`, and sends it a welcome call. From then on the hub calls the participant through the tunnel.
6. When the tunnel drops, the runtime registers again and opens a new tunnel with the same participant ID.

## Request flow

1. An application sends `POST /rooms/:code/v1/responses` or `POST /rooms/:code/v1/chat/completions`.
2. The hub picks an `online` participant by participant ID, model name, `model:<name>`, or `*`. See [Model routing](/reference/api/#model-routing).
3. The hub forwards the request through the participant tunnel.
4. The participant runtime forwards it to the real provider endpoint.
5. The runtime streams the provider response back through the tunnel.
6. The hub returns the response to the application client.

If the application closes the request, or the participant sends nothing for 5 minutes, the hub cancels the call in the tunnel and the runtime aborts the request to the provider.

```mermaid title="One inference request. Provider credentials are applied on the participant machine."
sequenceDiagram
  participant App as Your app
  participant Hub
  participant RT as Participant runtime
  participant P as Provider
  App->>Hub: POST /rooms/:code/v1/responses
  Note over Hub: route by participant id, model name, or *
  Hub->>RT: Infer call
  RT->>P: HTTP request with its own auth headers
  P-->>RT: response stream
  RT-->>Hub: status, then body chunks
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
- cancels and times out a request end to end

### SSE for observability

- one-way room event stream is enough for monitoring
- powers the TUI and operational clients
- keeps operational visibility separate from inference transport

Optional applications can build coordination above these contracts with
`gambi-sdk`: attach to harness participants, host their own, and keep their own
state. Their streams are not the hub room stream and do not change the public
hub API.

## Routing rules

The `model` field of an inference request selects the participant: a participant ID, a model name, `model:<name>`, or `*`. A participant is available only when it is `online`: its tunnel is open and it is not handling another request. Harness participants are never selected by `*` or a model name. The [API reference](/reference/api/#model-routing) has the full rules, including the fallback for an unknown participant ID.

## Tunnel protocol

The tunnel is a WebSocket the participant runtime opens to the hub. Over it, the roles are inverted: the participant serves typed calls and the hub makes them, using the RPC library of [Effect](https://effect.website). Every call goes from the hub to the participant:

- a welcome call when the tunnel opens, which tells the runtime it is `online` and how often the hub pings
- one streamed call per inference request: the runtime sends the request to its provider and streams the status and the body back. Interrupting the call aborts the request to the provider.
- for a harness participant, one long-lived stream the hub opens with the tunnel. Everything the harness produces (ACP messages, session status, workspace snapshots) goes up as pieces of that stream.
- for a harness participant, calls to send an ACP message, open a harness session, and close one

The hub pings the tunnel every 5 seconds and drops it after a missed ping. The runtime drops a tunnel whose hub has said nothing for 15 seconds, which catches a frozen hub. Either way, the participant goes `offline` and the runtime reconnects.

The wire format of these calls belongs to the RPC library and has no version of its own, which is why the hub and its participants must run the same minor version of Gambi.

Management clients attach to a harness participant through the hub, with a Server-Sent Events stream and plain HTTP requests. An attached client stays attached while the participant's tunnel is down, and hears `harness.connected` when the participant comes back.

## Protocol adaptation between Responses and Chat Completions

The default protocol is Responses. Chat Completions remains available for compatibility.

When a client uses Responses and the participant's provider only speaks Chat Completions, the hub creates the Response through Chat Completions and translates the answer. Two consequences:

- a client using Responses can reach a participant that only exposes Chat Completions
- the translation carries messages and function tools; a request that needs a stored conversation (`previous_response_id`, for example) or a tool that is not a function fails with `request_not_translatable`, and a translated Response cannot be read back, deleted, or cancelled later

A client using Chat Completions reaches the provider's Chat Completions as it is.

New integrations should prefer Responses. Fall back to Chat Completions only when you need explicit compatibility with an existing tool.

## Participant status

A participant has one status, derived from its tunnel: `offline` (registered, no open tunnel), `online` (tunnel open and idle), or `busy` (handling a request). Only `online` participants receive requests. A participant that stays `offline` for 60 seconds is removed from the room; the runtime reconnects well before that after a short drop, waiting 1 second and doubling up to 30.

Rooms live in the hub's memory. If the hub restarts, its rooms are gone, and participants that try to come back end with "room not found". Create the room again and rejoin.

## Observability

The hub emits a room snapshot when you start watching, an event for every change of a participant's status, and `llm.request`, `llm.complete`, and `llm.error` for inference. `llm.complete` carries timing and token metrics. See [Observability](/reference/observability/) for the fields.

## What Gambi does not do

- It does not host models.
- The hub has no built-in authentication. Run it on a trusted network, or behind your own proxy and authentication layer.
- The hub does not orchestrate models or harnesses. Applications can coordinate work through the SDK without moving that policy into the hub.

For where coordination above the hub is being explored, see [What's next](/concepts/whats-next/).
