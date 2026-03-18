# DurableClaw — Agent Setup Guide

This file is for you, the OpenClaw agent. It tells you how to wire up the Temporal workflow so the morning brief uses durable execution instead of running `gog` commands directly.

## What this does

DurableClaw wraps the morning brief pipeline in a Temporal workflow. Each step (calendar, email, USPS mail scans, LLM generation, Telegram delivery) is a separate Activity with its own timeout and retry policy. You no longer need to run `gog` commands, call the LLM, or send to Telegram yourself — the workflow handles everything, including retries.

## What to change

Update the morning brief cron job (ID: `a9e14c46-e317-4c00-b607-ab69771d4db3`) so that its message tells you to exec the trigger script instead of running gog commands directly.

**New cron job message:**

> Run the durable morning brief. Use `exec` to run:
> ```
> cd /home/lennessy/durableclaw && node lib/trigger.js
> ```
> This script triggers the Temporal workflow which fetches calendar, email, and USPS mail scans (with OCR), generates the brief via LLM, and sends it to Telegram — all with automatic retries. Do NOT run `gog` commands directly or send to Telegram yourself. The workflow handles everything. Just report the output of the trigger script.

## How the trigger script works

1. Starts `morningBriefWorkflow` on the Temporal server (localhost:7233)
2. Waits for it to complete (all retries happen inside the workflow)
3. Prints the generated brief to stdout
4. Exits 0 on success, 1 on failure

## What NOT to change

- Keep the same cron schedule (`30 8 * * *` America/Los_Angeles)
- Keep the same delivery config (Telegram to `1201740265`)
- Keep the same cron job ID — just update the message payload
- The lunch reminder cron job can stay as-is

## Workflow steps

```
morningBriefWorkflow
├── fetchCalendar()         — 30s timeout, 3 retries     ┐
├── fetchEmails()           — 30s timeout, 3 retries     ├── parallel
├── fetchUSPSMailScans()    — 45s timeout, 3 retries     ┘
├── generateBrief(data)     — 60s timeout, 3 retries
└── sendToTelegram(brief)   — 15s timeout, 5 retries
```

## Monitoring

- **Temporal Web UI**: http://192.168.50.243:58233 — see running/completed/failed workflows
- **Worker logs**: `journalctl -u durableclaw-worker -f`
- **Trigger output**: The trigger script prints the brief on success or the error on failure
