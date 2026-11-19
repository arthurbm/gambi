---
title: Common issues
description: Fixes for common problems with Gambi hubs, participants, and harnesses.
---

## Participant shows as offline

Symptoms:

- participant joined successfully but shows as offline
- requests fail because no participant is available

Causes and solutions:

A participant's status comes from its tunnel alone: `offline` means the hub has no open tunnel from it.

1. The participant is reconnecting.
   - After a drop, the participant runtime tries again by itself, waiting 1 second and doubling up to 30. Watch for `reconnecting` events in `gambi participant join --format ndjson`.
   - If it stays offline for 60 seconds, the hub removes it from the room. The runtime keeps trying, and its next registration brings it back with the same ID.

2. The tunnel cannot open.
   - Check whether the `gambi participant join` process is still running.
   - Check whether a firewall or proxy is blocking WebSocket upgrades.

3. The hub is unreachable.

```bash
curl http://hub-ip:3000/v1/health
```

## Connection timeout

Symptoms:

- requests hang and eventually time out
- you see `ETIMEDOUT` or `ECONNREFUSED`

Causes and solutions:

1. The hub is not running.

```bash
gambi hub serve --port 3000
```

2. The participant can reach the hub over HTTP, but the tunnel upgrade is blocked.
   - Test without an intermediate reverse proxy.
   - If you are using nginx, Caddy, or another proxy, ensure WebSocket upgrade headers are passed through.

3. The wrong hub URL is configured.

## mDNS discovery not working

Symptoms:

- discovery helpers do not find any hubs
- no rooms are discovered on the local network

Causes and solutions:

1. mDNS is not enabled.

```bash
gambi hub serve --mdns
```

2. Machines are on different network segments.

3. UDP port 5353 is blocked.

## CORS errors

Symptoms:

- browser console shows CORS errors
- Node.js usage works but browser usage does not

Causes and solutions:

The hub answers CORS for any origin, on both APIs.

1. A custom proxy is stripping CORS headers.
2. A custom proxy is also stripping WebSocket upgrade headers needed for participant tunnels.

## Request goes to the wrong participant

Symptoms:

- a request routes to a different participant than expected

Causes and solutions:

1. `gambi.model("llama3")` routes to the first available participant with that model.
   - Use `gambi.participant("worker-1")` to ask for one participant. It is not an exact target: when `worker-1` is busy or offline, another available participant serving a model named `worker-1` would take the request. Give participants IDs that are not model names.

2. The intended participant is offline or busy. Only `online` participants are picked.

3. A plain `model` value that is not a participant ID is treated as a model name. If no available participant has the ID you sent, the hub routes to the first available participant serving a model with that name. See [Model routing](/reference/api/#model-routing).

## Participant joins and is refused

Symptoms:

- `gambi participant join` exits with code `4` before it is online
- a custom runtime built on `createParticipantSession()` rejects with a `ParticipantError`

Read the error name (`--format json` puts it in `error.name`) or the `code`:

1. `VersionMismatch` / `VERSION_MISMATCH`: the participant runs another minor version of Gambi than the hub. The message names the version the hub expects. Install a release of that minor on the participant, or update both the hub and the participant to the latest release, so both are on the same minor (any `0.8.x` with any other `0.8.x`). `gambi self update` always installs the latest release.
2. `RoomNotFound` / `ROOM_NOT_FOUND`: check the room code with `gambi room list`.
3. `InvalidPassword` / `INVALID_PASSWORD`: pass the room password with `--password`.

Exit code `3` instead means the participant could not reach what it depends on: the hub (`HubUnreachable`, `NotAHub`), its provider (`EndpointUnreachable`, `ModelNotOnEndpoint`), the tunnel (`TunnelOpenFailed`), or its harness. The message says which.

## Participant stops after the hub restarts

Symptoms:

- the hub process was restarted, and `gambi participant join` ends with `left` and `reason: "refused"`, printing `RoomNotFound` and exiting with code `4`
- a custom runtime's `session.ended` resolves with `reason: "refused"`

Rooms live in the hub's memory, and room codes are random. A restarted hub comes back without its rooms, so a participant that tries to come back hears that the room does not exist and stops on purpose. Create the room again, share the new code, and join again.

The participant only comes back by itself when the hub was unreachable for a while (a Wi-Fi blink, a sleeping laptop) and returns with its rooms.

## Participant ends with `replaced`

Symptoms:

- `gambi participant join` ends with `left` and `reason: "replaced"`, exit code `4`
- a custom runtime's `session.ended` resolves with `reason: "replaced"`

Another runtime joined the same room with the same participant ID, and the hub kept the newer one. The replaced runtime does not try again, so the two never take the tunnel from each other. Give each running participant its own ID.

## A participant you removed comes back

`gambi participant leave` (or `DELETE /v1/rooms/:code/participants/:id`) removes a participant whoever hosts it. If its `gambi participant join` is still running, that runtime treats the closed tunnel as a drop and registers again about one second later. To take a running participant out for good, stop its `participant join` with Ctrl+C on its own machine.

## Streaming request ends with `consumer_too_slow`

The app read a streamed answer too slowly, and more than 8 Mi characters of it piled up on the hub. The hub cancels the request on the participant and ends the stream with this error. Read the stream as it arrives, or ask for an answer that is not a stream.

## Request fails with `inference_timeout`

The participant sent nothing for 5 minutes, before the first chunk or between two. The hub cancelled the request on the participant. A provider that takes longer than that to start answering (a very large model loading, for example) needs to be warmed up first.

## High latency

Symptoms:

- requests take much longer than expected
- streaming feels slow

Causes and solutions:

1. Network latency between participant and hub.
2. Slow provider or model.
3. Too many requests targeting too few participants.

Watch room events and look at `llm.complete.metrics` to inspect:

- `ttftMs`
- `durationMs`
- `tokensPerSecond`

## Harness participant fails to start or is rejected

Symptoms and fixes for `gambi participant join --harness`:

1. Exit code `3` before registration, with a message to install or log in.
   - The harness binary or its ACP adapter is missing, or there is no local login. Run the command the CLI prints, for example `opencode auth login`, `claude auth login`, or `codex login`, then retry. See [Bring your harness](/guides/bring-your-harness/#install-and-authenticate-your-harness).

2. Exit code `2` and an error that says the flags `cannot be used with --harness`.
   - Remove `--endpoint`, `--header`, and `--header-env`. The harness uses its own local login.

3. `Claude Code cannot run as a Gambi-hosted harness for third parties.`
   - An application called `createHarnessParticipantSession()` with `harness: "claude-code"` and `hosted: true`. The SDK rejects that combination. Each person must run Claude Code with their own login.

4. An inference request returns HTTP `400` with the code `inference_not_supported`.
   - The `model` value names a harness participant. Harness participants do not take OpenAI-compatible requests. Attach with `client.harness.attach()` instead.

5. `artifact_skipped` with `cause: "tooLarge"`.
   - The workspace snapshot is larger than 8 MiB, so it was not sent. Move large files out of the workspace.

6. A harness process keeps running after the participant is gone.
   - If `gambi participant join` (or your program) was killed with `kill -9`, it could not stop the harness. A harness that does not watch its standard input keeps running. Find it and stop it by hand. Ctrl+C and `SIGTERM` stop it normally.

## Still having issues?

1. Check the hub output. `gambi hub serve` writes its log lines to stderr (`--log-level debug` shows more), and `gambi events watch --room <code>` shows room events. An error from the CLI or the SDK may carry a `requestId`; look for it in the hub's log.

2. Test the provider endpoint directly:

```bash
curl http://localhost:11434/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3", "input": "Hi"}'
```

3. Open an issue on GitHub with:
   - the error message
   - steps to reproduce
   - environment details
