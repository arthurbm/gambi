---
title: Common Issues
description: Troubleshooting common problems with Gambi
---

# Common Issues

## Participant Shows as Offline

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

## Connection Timeout

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

## mDNS Discovery Not Working

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

## CORS Errors

Symptoms:

- browser console shows CORS errors
- Node.js usage works but browser usage does not

Causes and solutions:

1. A custom proxy is stripping CORS headers.
2. A custom proxy is also stripping WebSocket upgrade headers needed for participant tunnels.

## Request Goes To The Wrong Participant

Symptoms:

- a request routes to a different participant than expected

Causes and solutions:

1. `gambi.model("llama3")` routes to the first available participant with that model.
   - Use `gambi.participant("worker-1")` for exact targeting.

2. The intended participant is offline, busy, or tunnel-disconnected.

## High Latency

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

## Still Having Issues?

1. Check hub logs:

```bash
DEBUG=* gambi hub serve
```

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
