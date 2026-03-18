---
title: Home Lab Setup
description: Run Gambi as a permanent service in your home lab
---

# Home Lab Setup

Want to share your gaming PC's LLM with your laptop, tablet, or other devices? This guide covers setting up Gambi as a permanent service in your home lab.

## The Scenario

You have:
- **Server**: Desktop/gaming PC with GPU running Ollama 24/7
- **Clients**: Laptop, tablet, phone, or other devices that want to use the LLM

With Gambi, you can access your server's LLM from anywhere on your home network.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Home Network                       │
│                                                     │
│  ┌─────────────┐         ┌─────────────────────┐   │
│  │   Server    │         │      Clients        │   │
│  │  (GPU Box)  │◄───────►│  Laptop, Tablet...  │   │
│  │             │         │                     │   │
│  │ • Ollama    │         │ • SDK apps          │   │
│  │ • Hub       │         │ • Scripts           │   │
│  │ • Room      │         │ • Notebooks         │   │
│  └─────────────┘         └─────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Server Setup

### 1. Install Gambi

```bash
curl -fsSL https://raw.githubusercontent.com/arthurbm/gambi/main/scripts/install.sh | bash
```

### 2. Create a Systemd Service

Create `/etc/systemd/system/gambi-hub.service`:

```ini
[Unit]
Description=Gambi Hub
After=network.target

[Service]
Type=simple
User=your-username
ExecStart=/usr/local/bin/gambi serve --port 3000 --mdns
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable gambi-hub
sudo systemctl start gambi-hub
```

### 3. Create a Persistent Room

You'll want the same room code every time. Create a startup script:

```bash
#!/bin/bash
# /home/your-username/gambi-setup.sh

# Wait for hub to be ready
sleep 5

# Create room (or use existing)
ROOM_CODE=$(gambi create 2>/dev/null | grep -oP 'Code: \K\w+')
echo "Room code: $ROOM_CODE"

# Join with local Ollama
gambi join $ROOM_CODE \
  --endpoint http://localhost:11434 \
  --model llama3 \
  --nickname homelab-gpu
```

Or add another systemd service for the participant:

```ini
[Unit]
Description=Gambi Participant
After=gambi-hub.service ollama.service
Requires=gambi-hub.service

[Service]
Type=simple
User=your-username
ExecStartPre=/bin/sleep 5
ExecStart=/usr/local/bin/gambi join YOURCODE --endpoint http://localhost:11434 --model llama3 --nickname homelab
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 4. Optional: Static Room Code

For a truly permanent setup, you can hardcode a room code. Check the hub logs for the generated code, or look at implementing room persistence (see Roadmap).

## Client Setup

### From Another Machine

```typescript
import { createGambi } from "gambi-sdk";
import { generateText } from "ai";

const gambi = createGambi({
  roomCode: "YOUR_ROOM_CODE",
  hubUrl: "http://192.168.1.100:3000", // Your server's IP
});

const result = await generateText({
  model: gambi.any(),
  prompt: "Hello from my laptop!",
});
```

### Using mDNS

If mDNS works on your network (most home networks), you can skip the IP:

```typescript
const gambi = createGambi({
  roomCode: "YOUR_ROOM_CODE",
  // Hub discovered automatically via mDNS
});
```

### From Scripts

Simple shell script to test:

```bash
#!/bin/bash
curl -X POST http://192.168.1.100:3000/rooms/YOURCODE/v1/responses \
  -H "Content-Type: application/json" \
  -d '{
    "model": "*",
    "input": "Hello!"
  }'
```

## Security Considerations

### Home Network Only

Gambi is designed for trusted local networks. Don't expose it to the internet without additional security measures.

### Firewall Rules

Allow traffic only from your local network:

```bash
# UFW example
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

### Future: Password Protection

Room password protection is on the roadmap. For now, rely on network isolation.

## Multiple LLMs

You can run multiple models on the same server:

```bash
# Terminal 1: Join with llama3
gambi join YOURCODE \
  --endpoint http://localhost:11434 \
  --model llama3 \
  --nickname homelab-llama

# Terminal 2: Join with mistral (same Ollama, different model)
gambi join YOURCODE \
  --endpoint http://localhost:11434 \
  --model mistral \
  --nickname homelab-mistral
```

Then target specific models from clients:

```typescript
// Use llama for code
const code = await generateText({
  model: gambi.model("llama3"),
  prompt: "Write a function...",
});

// Use mistral for text
const text = await generateText({
  model: gambi.model("mistral"),
  prompt: "Write an email...",
});
```

## Monitoring

### Check Hub Status

```bash
sudo systemctl status gambi-hub
```

### View Logs

```bash
sudo journalctl -u gambi-hub -f
```

### List Participants

```bash
gambi list
```

## Troubleshooting

### Service Won't Start

1. Check logs: `sudo journalctl -u gambi-hub -n 50`
2. Verify gambi is installed: `which gambi`
3. Test manually: `gambi serve --port 3000`

### Can't Connect from Client

1. Check server firewall
2. Verify IP address: `ip addr` on server
3. Test connectivity: `ping 192.168.1.100` from client
4. Test port: `nc -zv 192.168.1.100 3000`

### Ollama Not Responding

1. Check Ollama is running: `curl http://localhost:11434/v1/models`
2. Verify model is pulled: `ollama list`
3. Check Ollama logs

## What's Next?

- Add more models as participants
- Set up [monitoring with TUI](/guides/quickstart/#terminal-ui)
- Check [Troubleshooting](/troubleshooting/common-issues/) for common issues
- See the [Architecture](/architecture/overview/) to understand how it all works
