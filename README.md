# webot

A push notification assistant for Weixin, powered by [ClawBot](https://github.com/nicepkg/claw-bot). Think of it as [Bark](https://github.com/Finb/Bark) — but entirely inside Weixin, with no extra app to install.

> **Note:** Currently only **Weixin** (微信) is supported. WeChat (the international version) is not yet supported by ClawBot.

## Why

Bark is great for push notifications on iOS, but it requires installing a separate app. If you already live in Weixin, why not receive notifications right there?

**webot** turns a Weixin account into a push endpoint. Any system that can make an HTTP request — CI/CD pipelines, monitoring alerts, cron jobs, home automation, scripts — can push messages directly to your Weixin.

## How It Works

webot uses [ClawBot](https://github.com/nicepkg/claw-bot) (via `weixin-agent-sdk`) to connect to Weixin as a bot. It keeps a long-polling session with the Weixin API and exposes a simple HTTP push API.

```
External System                        Weixin
  (curl, webhook,        ┌──────────┐
   CI/CD, script)  ────► │  webot   │ ────► Your Weixin
                          │          │       (push notification)
  POST /api/send          │ HTTP API │
  + Bearer token          │ + WX Bot │
                          └──────────┘
```

1. **You message the bot first** from Weixin — this is required by the Weixin platform to establish a session.
2. The bot replies with your **user ID** and the **push API details** (token + endpoint), ready to copy and use.
3. From then on, any HTTP `POST /api/send` with your user ID will deliver a message to your Weixin.

Optionally, you can enable OpenAI to give the bot AI chat capabilities — but the core use case is push notifications.

## Quick Start

### Prerequisites

- Node.js >= 22
- A Weixin account

### Setup

```bash
# Clone
git clone https://github.com/missuo/webot.git
cd webot

# Install dependencies
pnpm install

# Link your Weixin account (scan QR code in terminal)
pnpm run login

# Configure
cp .env.example .env
# Edit .env — set API_TOKEN (required)
```

### Run

```bash
pnpm start
```

Then send any message to the bot from Weixin. It will reply with something like:

```
Push API ready:
POST /api/send
Authorization: Bearer your-secret-token
Body: {"userId": "your-user-id", "text": "..."}
```

Now you can push messages from anywhere:

```bash
curl -X POST https://your-server.com/api/send \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "text": "Deploy succeeded ✅"}'
```

## Configuration

All configuration is via `.env`. See [`.env.example`](.env.example).

| Variable         | Required | Default    | Description                           |
| ---------------- | -------- | ---------- | ------------------------------------- |
| `API_TOKEN`       | Yes      | —          | Bearer token for the push API         |
| `OPENAI_API_KEY`  | No       | —          | OpenAI API key (enables AI chat)      |
| `OPENAI_BASE_URL` | No       | —          | Custom OpenAI-compatible API endpoint |
| `OPENAI_MODEL`    | No       | `gpt-4o`   | Chat model name                       |
| `IMAGE_MODEL`     | No       | `dall-e-3` | Image generation model                |
| `SYSTEM_PROMPT`   | No       | —          | System prompt for the AI agent        |
| `HTTP_PORT`       | No       | `3000`     | HTTP server port                      |

## API Reference

### `POST /api/send`

Push a message to a Weixin user. Requires `Authorization: Bearer <API_TOKEN>`.

```json
{
  "userId": "user-id",
  "text": "Hello from API",
  "accountId": "optional-bot-account-id"
}
```

| Status | Response |
| ------ | -------- |
| `200`  | `{"ok": true}` |
| `400`  | `{"error": "userId and text are required"}` |
| `401`  | `{"error": "Unauthorized"}` |
| `500`  | `{"error": "..."}` |

### `GET /`

Health check. Returns `{"status": "ok"}`.

> **Note:** You can only push messages to users who have previously messaged the bot. This is a Weixin platform requirement — each session is initiated by the user.

## Deployment

webot runs as a **long-lived process** (not serverless). Deploy it on any server that stays on.

### Using PM2

```bash
pnpm run login          # Scan QR code once
pm2 start "pnpm start" --name webot
```

### Using systemd

Create `/etc/systemd/system/webot.service`:

```ini
[Unit]
Description=webot
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/webot
ExecStart=/usr/bin/env node --env-file=.env --import=tsx/esm main.ts start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl enable --now webot
```

### Using Docker

```dockerfile
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["node", "--env-file=.env", "--import=tsx/esm", "main.ts", "start"]
```

### Notes

- Run `pnpm run login` once to link your Weixin account. The login token is persisted locally — subsequent restarts reuse it unless it expires.
- Put a reverse proxy (nginx, Caddy) in front if you want HTTPS for the push API.
- Set `HTTP_PORT` if port 3000 conflicts with other services.

## License

MIT
