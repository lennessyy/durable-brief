# durableclaw

Adding durable, retry-safe execution to an AI agent's daily workflows using [Temporal](https://temporal.io).

## The problem

I run an [OpenClaw](https://github.com/nichochar/open-claw) agent on a home server that sends me a personalized morning brief every day. It fetches my Google Calendar, Gmail inbox, and USPS Informed Delivery mail scans, feeds everything to an LLM, and delivers the result to Telegram.

The problem: it fails **~26% of the time**. Google API calls timeout, the LLM provider drops requests, Telegram delivery flakes — and when any single step fails, all prior work is lost and the whole job has to restart from scratch.

## The fix

Temporal wraps each step as an **Activity** with its own timeout and retry policy. Steps run in parallel where possible, retry independently on failure, and the Workflow only fails if retries are fully exhausted.

```
morningBriefWorkflow
├── fetchCalendar()         — 30s timeout, 3 retries     ┐
├── fetchEmails()           — 30s timeout, 3 retries     ├── parallel
├── fetchUSPSMailScans()    — 45s timeout, 3 retries     ┘
├── generateBrief(data)     — 60s timeout, 3 retries
└── sendToTelegram(brief)   — 15s timeout, 5 retries
```

If `fetchEmails()` times out, it retries on its own while the calendar and USPS results stay safe. If the LLM call fails after all the data is already collected, Temporal replays from the `generateBrief` step — no refetching. If Telegram is down, it retries 5 times with backoff before giving up.

### USPS mail scan OCR

USPS Informed Delivery emails include scanned images of incoming mail. DurableClaw downloads these images and runs [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) locally to extract sender information, so the morning brief can tell me who's sending physical mail — not just that mail is coming.

## Architecture

```
src/
├── activities.ts    # Activity implementations (Google API via gog CLI, Tesseract OCR, LLM, Telegram)
├── workflows.ts     # morningBriefWorkflow — orchestrates activities with parallel execution
├── worker.ts        # Temporal Worker process
└── trigger.ts       # CLI script to start a workflow and print the result
```

The existing OpenClaw cron job triggers `trigger.ts`, which starts the Temporal workflow and waits for the result. The Temporal dev server, Worker, and OpenClaw all run on the same machine.

## Setup

### Prerequisites

- Node.js 22+
- [Temporal CLI](https://docs.temporal.io/cli) (`curl -sSf https://temporal.download/cli | sh`)
- [gog](https://github.com/reecerose/gog) CLI installed and authenticated
- [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (`brew install tesseract` / `sudo apt install tesseract-ocr`)

### Install

```bash
git clone https://github.com/lenny/durableclaw.git
cd durableclaw
npm install
npm run build
```

### Configure

```bash
cp .env.example .env
# Edit .env with your API keys
```

| Variable | Description |
|---|---|
| `LLM_API_KEY` | API key for your LLM provider |
| `LLM_BASE_URL` | OpenAI-compatible completions endpoint (default: Venice AI) |
| `LLM_MODEL` | Model name (default: `llama-3.3-70b`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for delivery |
| `TELEGRAM_CHAT_ID` | Telegram chat ID to deliver briefs to |
| `GOG_PATH` | Path to `gog` binary (default: `/usr/local/bin/gog`) |
| `TESSERACT_PATH` | Path to `tesseract` binary (default: `/usr/bin/tesseract`) |

### Run

**1. Start the Temporal dev server:**

```bash
temporal server start-dev
```

**2. Start the Worker:**

```bash
npm start
```

**3. Trigger a workflow:**

```bash
npm run trigger
```

### Running as a service

Example systemd unit files are in [`services/`](services/). Copy them, adjust the paths for your system, then:

```bash
sudo cp services/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now temporal-dev durableclaw-worker
```

## Adapting this for your own agent

The pattern here is general — any multi-step agent workflow with unreliable external calls benefits from Temporal:

1. Define each external call as an Activity with appropriate timeouts
2. Group Activities by reliability profile (flaky APIs get more retries, LLM calls get longer timeouts)
3. Run independent Activities in parallel with `Promise.all`
4. Let your existing scheduler (cron, agent framework, etc.) trigger the Temporal workflow via the client SDK

The workflow code itself is ~20 lines. Most of the value comes from Temporal's retry and replay semantics — you get durability without writing any retry logic yourself.
