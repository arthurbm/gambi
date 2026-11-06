---
title: Common issues
description: Fixes for common problems with Gambi hubs, participants, and harnesses.
---

## Participant shows as offline

Symptoms:

- participant joined successfully but shows as offline
- requests fail because no participant is available

Causes and solutions:

1. Health checks are failing.
   - The participant sends a heartbeat every 10 seconds.
   - If the hub misses them for 30 seconds, the participant is marked offline.
   - Check whether the `gambi participant join` process is still running.

2. The participant tunnel is disconnected.
   - A participant is only routable while its tunnel is connected.
   - Restart `gambi participant join`.
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

1. A custom proxy is stripping CORS headers.
2. A custom proxy is also stripping WebSocket upgrade headers needed for participant tunnels.

## Request goes to the wrong participant

Symptoms:

- a request routes to a different participant than expected

Causes and solutions:

1. `gambi.model("llama3")` routes to the first available participant with that model.
   - Use `gambi.participant("worker-1")` for exact targeting.

2. The intended participant is offline, busy, or tunnel-disconnected.

3. A plain `model` value that is not a participant ID is treated as a model name. If no available participant has the ID you sent, the hub routes to the first available participant serving a model with that name. See [Model routing](/reference/api/#model-routing).

## Participant reports `tunnel_failed` or `heartbeat_failed`

Symptoms:

- `gambi participant join --format ndjson` emits a `tunnel_failed` event and exits
- `gambi participant join --format ndjson` emits a `heartbeat_failed` event and exits
- a custom runtime built on `createParticipantSession()` reports a close reason of `"tunnel_closed"` or `"heartbeat_failed"`

These are different failures. Diagnose by the lifecycle event or close reason. Neither the CLI nor the SDK reconnects on its own: restart the participant with the same participant ID.

### `tunnel_failed` / close reason `"tunnel_closed"`

The WebSocket tunnel to the hub was interrupted. Common causes:

1. A proxy between the participant and the hub is stripping `Upgrade: websocket`. Test by pointing the participant directly at the hub, bypassing the proxy.
2. The hub process was restarted or crashed. Check hub logs and retry.
3. The bootstrap token expired before the participant finished upgrading. The token has a 60-second TTL; a stalled or slow network can miss that window. Re-running `gambi participant join` issues a new token.
4. The hub evicted the previous tunnel because the same participant id reconnected from elsewhere. Decide whether you intend to run two runtimes with the same id and pick a different id if not.

### `heartbeat_failed`

A management HTTP heartbeat request failed. One failed request is enough to close the session. This is about HTTP reachability to `/v1`, not the WebSocket path. Common causes:

1. The hub URL is wrong or stale.
2. A proxy or firewall is blocking `POST /v1/rooms/:code/participants/:id/heartbeat`.
3. The room or participant was deleted from the hub while the runtime was still running. Check with `gambi room get` and `gambi participant join` again.

After `heartbeat_failed`, the runtime tries to remove itself from the room. After `tunnel_closed`, it does not: the registration stays until the hub marks it offline 30 seconds after the last heartbeat. Either way, restarting with the same participant ID is safe, because registration is idempotent.

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

2. Exit code `2` and an error ending in `cannot be used with --harness`.
   - Remove `--endpoint`, `--header`, and `--header-env`. The harness uses its own local login.

3. `Claude Code cannot run as a Gambi-hosted harness for third parties.`
   - An application called `createHarnessParticipantSession()` with `harnessId: "claude-code"` and `hosted: true`. The SDK rejects that combination. Each person must run Claude Code with their own login.

4. An inference request returns HTTP `400` with `Harness participants do not serve inference requests`.
   - The `model` value names a harness participant. Harness participants do not take OpenAI-compatible requests. Attach with `client.harness.attach()` instead.

## Still having issues?

1. Check the hub output. The hub prints `[gambi] llm.request`, `[gambi] llm.complete`, and `[gambi] llm.error` lines to the console, and `gambi events watch --room <code>` shows room events.

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
