# Durable Brief

Durable Brief is a small [Temporal](https://temporal.io) project that runs a daily AI briefing pipeline with durable execution. It fetches data from external sources, generates a summary with an LLM, and delivers the result to Telegram.

## What it does

The Workflow orchestrates each external step as a Temporal Activity so the full run is reliable and repeatable.

- Fetches Google Calendar data
- Fetches Gmail data
- Fetches USPS Informed Delivery scans
- Uses local [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) to extract sender text from mail images
- Generates a morning brief with an LLM
- Sends the final brief to Telegram

## Workflow shape

This is the default execution flow and retry profile used by `morningBriefWorkflow`.

```
morningBriefWorkflow
├── fetchCalendar()         — 30s timeout, 3 retries     ┐
├── fetchEmails()           — 30s timeout, 3 retries     ├── parallel
├── fetchUSPSMailScans()    — 45s timeout, 3 retries     ┘
├── generateBrief(data)     — 60s timeout, 3 retries
└── sendToTelegram(brief)   — 15s timeout, 5 retries
```

## Architecture

The project is intentionally small: one Workflow, a set of Activities, one Worker, and one trigger script.

```
src/
├── activities.ts    # Activity implementations (Google API via gog CLI, Tesseract OCR, LLM, Telegram)
├── workflows.ts     # morningBriefWorkflow orchestration
├── worker.ts        # Temporal Worker process
└── trigger.ts       # CLI script to start a Workflow and print the result
```

## Setup

Use the steps below to install dependencies, configure credentials, and run the Workflow locally.

### Prerequisites

Install these tools first. Durable Brief depends on them at runtime for Workflow execution, data collection, and OCR.

- Node.js 22 or newer
- [Temporal CLI](https://docs.temporal.io/cli) (for local dev server): `curl -sSf https://temporal.download/cli | sh`
- [gog](https://github.com/reecerose/gog) CLI installed and authenticated (for Google Calendar and Gmail access)
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) installed (`brew install tesseract` or `sudo apt install tesseract-ocr`)

### Install

Clone the repository, install packages, and build the TypeScript project.

```bash
git clone https://github.com/lenny/durableclaw.git
cd durableclaw
npm install
npm run build
```

### Configure

Create a local environment file and then set the required credentials and optional binary paths.

```bash
cp .env.example .env
# Edit .env with your values
```

The following environment variables control model access, delivery, and local binary paths.

| Variable | Description |
|---|---|
| `LLM_API_KEY` | API key for your LLM provider |
| `LLM_BASE_URL` | OpenAI-compatible completions endpoint (default: Venice AI) |
| `LLM_MODEL` | Model name (default: `llama-3.3-70b`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token used for message delivery |
| `TELEGRAM_CHAT_ID` | Telegram chat ID that receives briefs |
| `GOG_PATH` | Path to the `gog` binary (default: `/usr/local/bin/gog`) |
| `TESSERACT_PATH` | Path to the `tesseract` binary (default: `/usr/bin/tesseract`) |

### Run

Run these commands in separate terminals: start Temporal, start the Worker, then trigger a Workflow Execution.

1. Start the Temporal dev server.

```bash
temporal server start-dev
```

2. Start the Worker.

```bash
npm start
```

3. Trigger a Workflow.

```bash
npm run trigger
```

### Running as a service

If you want this to run continuously on Linux, use the provided `systemd` unit files and adjust paths for your system.

```bash
sudo cp services/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now temporal-dev durableclaw-worker
```

## Adapt for your own agent

You can reuse this pattern for any multi-step agent pipeline that calls external APIs or services.

1. Model each external call as an Activity with timeout and retry settings.
2. Run independent calls in parallel with `Promise.all`.
3. Keep orchestration logic in the Workflow and side effects in Activities.
4. Trigger the Workflow from your existing scheduler or agent framework.
