# durableclaw

Adds durable, retry-safe execution to OpenClaw agent workflows using [Temporal](https://temporal.io).

## Problem

The OpenClaw morning brief cron job fails ~26% of the time. Failures include:
- `gog` CLI calls to Google APIs timing out
- LLM provider (Venice AI) timing out or returning errors
- The entire job timing out before all steps complete
- Telegram delivery errors
- USPS Informed Delivery images were never parsed — only metadata was shown

When any single step fails, all work from previous steps is lost and the whole job must re-run from scratch.

## Solution

Temporal wraps each step as an **Activity** with its own timeout and retry policy. Steps run in parallel where possible, retry independently on failure, and the Workflow only fails if retries are fully exhausted.

USPS Informed Delivery mail scans are now downloaded and OCR'd locally using Tesseract, so the brief includes who the mail is actually from.

```
morningBriefWorkflow
├── fetchCalendar()         — 30s timeout, 3 retries     ┐
├── fetchEmails()           — 30s timeout, 3 retries     ├── parallel
├── fetchUSPSMailScans()    — 45s timeout, 3 retries     ┘
├── generateBrief(data)     — 60s timeout, 3 retries
└── sendToTelegram(brief)   — 15s timeout, 5 retries
```

### What each activity does

- **fetchCalendar()** — runs `gog calendar events --today --all`
- **fetchEmails()** — runs two `gog` Gmail searches in parallel: unread inbox (excluding promotions/social/forums) and Amazon shipping/delivery emails from the last 24h
- **fetchUSPSMailScans()** — finds the latest USPS Informed Delivery email, downloads the scanned mail images, and runs Tesseract OCR on each to extract sender info
- **generateBrief(data)** — sends all collected data to the LLM (Venice AI) to generate the morning brief
- **sendToTelegram(brief)** — delivers the brief to Telegram

## Project structure

```
src/
├── activities.ts    # Activity implementations (gog CLI, Tesseract OCR, LLM, Telegram)
├── workflows.ts     # morningBriefWorkflow definition
├── worker.ts        # Temporal Worker — runs continuously, executes workflows
└── trigger.ts       # CLI script to start a workflow execution and print the result
```

## Setup

### Prerequisites

- Node.js 22+
- `gog` CLI installed and authenticated (`gog auth status` should show valid credentials)
- Temporal CLI (`curl -sSf https://temporal.download/cli | sh`)
- Tesseract OCR (`sudo apt install tesseract-ocr`)

### Install and build

```bash
git clone <this-repo> ~/durableclaw
cd ~/durableclaw
npm install
npm run build
```

### Configure

```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
- `LLM_API_KEY` — Venice API key (from OpenClaw's `agents/main/agent/auth-profiles.json`)
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (from `openclaw.json` → `channels.telegram.botToken`)
- `TELEGRAM_CHAT_ID` — Telegram chat ID to deliver briefs to

### Run

**1. Start the Temporal dev server** (keep running):

```bash
temporal server start-dev --ui-ip 0.0.0.0 --ui-port 58233 --db-filename /tmp/temporal.db
```

The Temporal Web UI will be available at http://192.168.50.243:58233 from the local network.

**2. Start the Worker** (keep running):

```bash
cd ~/durableclaw
npm start
```

**3. Trigger a workflow** (from cron or manually):

```bash
cd ~/durableclaw
npm run trigger
```

This starts `morningBriefWorkflow`, waits for it to complete, and prints the generated brief to stdout. Exit code 0 on success, 1 on failure.

## Wiring up with OpenClaw cron

The OpenClaw cron job should trigger the Temporal workflow instead of running `gog` commands directly.

### What to change

Update the morning brief cron job (ID: `a9e14c46-e317-4c00-b607-ab69771d4db3`) so that its message tells the agent to exec the trigger script instead of running gog commands:

**New cron job message:**

> Run the durable morning brief. Use `exec` to run:
> ```
> cd /home/lennessy/durableclaw && node lib/trigger.js
> ```
> This script triggers the Temporal workflow which fetches calendar, email, and USPS mail scans (with OCR), generates the brief via LLM, and sends it to Telegram — all with automatic retries. Do NOT run `gog` commands directly or send to Telegram yourself. The workflow handles everything. Just report the output of the trigger script.

The trigger script:
1. Starts `morningBriefWorkflow` on the Temporal server
2. Waits for it to complete (all retries happen inside the workflow)
3. Prints the generated brief to stdout
4. Exits 0 on success, 1 on failure

The lunch reminder cron job can stay as-is — it's simple enough and doesn't fail often.

### What NOT to change

- Keep the same cron schedule (`30 8 * * *` America/Los_Angeles)
- Keep the same delivery config (Telegram to `1201740265`)
- Keep the same cron job ID — just update the message payload

## Running as a service

The Temporal server and Worker should survive reboots. Systemd services:

```ini
# /etc/systemd/system/temporal-dev.service
[Unit]
Description=Temporal Dev Server
After=network.target

[Service]
Type=simple
User=lennessy
ExecStart=/home/linuxbrew/.linuxbrew/bin/temporal server start-dev --ui-ip 0.0.0.0 --ui-port 58233 --db-filename /tmp/temporal.db
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/durableclaw-worker.service
[Unit]
Description=DurableClaw Temporal Worker
After=temporal-dev.service
Requires=temporal-dev.service

[Service]
Type=simple
User=lennessy
WorkingDirectory=/home/lennessy/durableclaw
EnvironmentFile=/home/lennessy/durableclaw/.env
ExecStart=/usr/bin/node lib/worker.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable temporal-dev durableclaw-worker
sudo systemctl start temporal-dev durableclaw-worker
```

## Monitoring

- **Temporal Web UI**: http://192.168.50.243:58233 — see running/completed/failed workflows, drill into individual activity attempts and retries
- **Worker logs**: `journalctl -u durableclaw-worker -f`
- **Trigger output**: The trigger script prints the brief on success or the error on failure
