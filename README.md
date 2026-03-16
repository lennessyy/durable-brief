# durableclaw

Adds durable, retry-safe execution to OpenClaw agent workflows using [Temporal](https://temporal.io).

## Problem

The OpenClaw morning brief cron job fails ~26% of the time. Failures include:
- `gog` CLI calls to Google APIs timing out
- LLM provider (Venice AI) timing out or returning errors
- The entire job timing out before all steps complete
- Telegram delivery errors

When any single step fails, all work from previous steps is lost and the whole job must re-run from scratch.

## Solution

Temporal wraps each step as an **Activity** with its own timeout and retry policy. Steps run in parallel where possible, retry independently on failure, and the Workflow only fails if retries are fully exhausted.

```
morningBriefWorkflow
├── fetchCalendar()        — 30s timeout, 3 retries, 5s backoff
├── fetchGmail()           — 30s timeout, 3 retries, 5s backoff      (parallel)
├── fetchUSPSEmails()      — 30s timeout, 3 retries, 5s backoff      (parallel)
├── fetchAmazonEmails()    — 30s timeout, 3 retries, 5s backoff      (parallel)
├── generateBrief(data)    — 60s timeout, 3 retries, 10s backoff
└── sendToTelegram(brief)  — 15s timeout, 5 retries, 3s backoff
```

## Project structure

```
src/
├── activities.ts    # Activity implementations (gog CLI, LLM, Telegram)
├── workflows.ts     # morningBriefWorkflow definition
├── worker.ts        # Temporal Worker — runs continuously, executes workflows
└── trigger.ts       # CLI script to start a workflow execution
```

## Setup

### Prerequisites

- Node.js 22+
- `gog` CLI installed and authenticated (`gog auth status` should show valid credentials)
- Temporal CLI (`curl -sSf https://temporal.download/cli | sh`)

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
temporal server start-dev
```

The Temporal Web UI will be available at http://localhost:8233.

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

Replace the existing OpenClaw morning brief cron job's payload so that instead of running `gog` commands directly, it triggers the Temporal workflow:

**Old approach** (in OpenClaw cron `jobs.json`):
The agent runs `gog` commands via `exec`, calls the LLM, and delivers — all in one shot with a shared timeout.

**New approach**:
The OpenClaw cron job should use `exec` to run the trigger script:

```bash
cd /home/lennessy/durableclaw && node lib/trigger.js
```

The trigger script:
1. Starts `morningBriefWorkflow` on the Temporal server
2. Waits for the result (the generated brief text)
3. Prints the brief to stdout
4. Exits 0 on success

The workflow handles all retries, timeouts, and Telegram delivery internally. OpenClaw just needs to kick it off.

### What to change in OpenClaw

Update the morning brief cron job message to something like:

> Run the durable morning brief workflow. Use `exec` to run: `cd /home/lennessy/durableclaw && node lib/trigger.js`
> The script will output the brief that was generated and sent to Telegram. No need to run `gog` commands directly or send to Telegram — the workflow handles all of that with automatic retries.

The lunch reminder cron job can stay as-is (it's simple enough and doesn't fail often).

## Running as a service

For production, the Temporal server and Worker should survive reboots. A simple approach using systemd:

```bash
# /etc/systemd/system/temporal-dev.service
[Unit]
Description=Temporal Dev Server
After=network.target

[Service]
Type=simple
User=lennessy
ExecStart=/home/lennessy/.temporalio/bin/temporal server start-dev
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable temporal-dev durableclaw-worker
sudo systemctl start temporal-dev durableclaw-worker
```

## Monitoring

- **Temporal Web UI**: http://localhost:8233 — see running/completed/failed workflows, drill into individual activity attempts
- **Worker logs**: `journalctl -u durableclaw-worker -f`
- **Trigger output**: The trigger script prints the brief on success or the error on failure
