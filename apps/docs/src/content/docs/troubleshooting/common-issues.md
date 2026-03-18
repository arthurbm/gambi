---
title: Common Issues
description: Troubleshooting common problems with Gambi
---

# Common Issues

## Participant Shows as Offline

**Symptoms:**
- Participant joined successfully but shows as offline
- Requests fail with "No online participants"

**Causes & Solutions:**

1. **Health check failing** - The participant sends health checks every 10 seconds. If the hub doesn't receive them for 30 seconds, the participant is marked offline.
   - Check if the participant process is still running
   - Check network connectivity between participant and hub

2. **Firewall blocking traffic** - Ensure the hub port (default 3000) is accessible.
   ```bash
   # Test connectivity
   curl http://hub-ip:3000/rooms
   ```

3. **Wrong hub URL** - Verify the participant is connecting to the correct hub.

## Connection Timeout

**Symptoms:**
- Requests hang and eventually timeout
- "ETIMEDOUT" or "ECONNREFUSED" errors

**Causes & Solutions:**

1. **Hub not running** - Start the hub first:
   ```bash
   gambi serve --port 3000
   ```

2. **Wrong port** - Ensure you're using the same port everywhere.

3. **Network issues** - Check if machines can reach each other:
   ```bash
   ping hub-ip
   ```

4. **Participant published `localhost` to a remote hub** - `localhost` only works on the participant machine itself.
   - Let Gambi auto-rewrite it in interactive mode
   - Or pass `--network-endpoint http://<participant-lan-ip>:11434`
   - Use `--no-network-rewrite` only if you intentionally want to opt out

## mDNS Discovery Not Working

**Symptoms:**
- `gambi list` doesn't find any hubs
- "No hubs found on network"

**Causes & Solutions:**

1. **mDNS not enabled** - Start the hub with `--mdns` flag:
   ```bash
   gambi serve --mdns
   ```

2. **Different network segments** - mDNS only works on the same local network segment. VPNs and different subnets won't work.

3. **Firewall blocking mDNS** - mDNS uses UDP port 5353. Ensure it's not blocked.

4. **macOS/Linux permission issues** - mDNS may require elevated privileges on some systems.

## CORS Errors

**Symptoms:**
- Browser console shows CORS errors
- SDK works from Node.js but not from browser

**Causes & Solutions:**

Gambi's hub includes CORS headers by default. If you're still seeing errors:

1. **Custom proxy interfering** - If using a reverse proxy (nginx, Caddy), ensure it passes CORS headers.

2. **Different origin** - The SDK must be served from the same origin or the hub must allow the origin.

## Request Goes to Wrong Participant

**Symptoms:**
- Request goes to a different participant than expected
- `gambi.model("llama3")` routes to wrong endpoint

**Causes & Solutions:**

1. **Multiple participants with same model** - When using `gambi.model()`, it routes to the first online participant with that model. Use `gambi.participant()` for specific targeting.

2. **Participant went offline** - The routing falls back to available participants.

## SDK Not Finding Hub

**Symptoms:**
- "Failed to connect to hub" errors
- SDK initialization fails

**Causes & Solutions:**

1. **Wrong hubUrl** - Ensure the URL is correct:
   ```typescript
   const gambi = createGambi({
     roomCode: "ABC123",
     hubUrl: "http://192.168.1.100:3000", // Include protocol and port
   });
   ```

2. **Hub on different network** - If using mDNS, both SDK and hub must be on the same network.

## High Latency

**Symptoms:**
- Requests take much longer than expected
- Streaming feels slow

**Causes & Solutions:**

1. **Network latency** - Check ping times between machines.

2. **LLM endpoint slow** - The bottleneck is usually the LLM itself, not Gambi.

3. **Too many concurrent requests** - Consider adding more participants to distribute load.

## Still Having Issues?

1. **Check logs** - Run the hub with verbose output:
   ```bash
   DEBUG=* gambi serve
   ```

2. **Test endpoint directly** - Verify the LLM endpoint works:
   ```bash
   curl http://localhost:11434/v1/responses \
     -H "Content-Type: application/json" \
     -d '{"model": "llama3", "input": "Hi"}'
   ```

3. **Open an issue** - If the problem persists, [open an issue on GitHub](https://github.com/arthurbm/gambi/issues) with:
   - Error message
   - Steps to reproduce
   - Environment (OS, Node version, LLM provider)
