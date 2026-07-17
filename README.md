# Telegram Assistant Bot

A personal AI assistant you text on Telegram — an agent that manages your email, calendar, goals, reminders, and automations. All data lives in a Google Sheet.

## Assistant features

Talk to it naturally — free text goes through an LLM agent that takes real actions with tools:

- **Email agent** — "summarize my unread emails", "draft a reply to the recruiter". Reads, triages, and drafts in Gmail (drafts by default; it only sends after you confirm the exact content).
- **Meeting scheduler** — "what's on Thursday?", "find me a free 30-min slot tomorrow", "move my dentist appointment to 4pm". Lists, creates, reschedules, and deletes Google Calendar events, and finds free slots.
- **Reminders** — "remind me at 5pm to call mom". One-off reminders fire as Telegram messages (checked every minute).
- **Automations** — "every weekday at 7am, send me my email summary". Stores a cron schedule + prompt; each tick runs the agent and messages you the result.
- **Memory** — "remember that I prefer morning meetings". Facts persist in the sheet and are injected into every conversation. The agent also saves preferences and corrections proactively.
- **Web research** — "what's the latest on X?" via keyless DuckDuckGo/Wikipedia search, plus the news digest.
- **Goal tracking** — daily + one-off goals, streaks, check-ins ("did 3 leetcodes"), weekly/monthly life-coach summaries.
- **Job application tracker** — log applications and status changes by chat.
- **Daily briefing** — the morning digest bundles news, today's calendar, unread-email triage, and reminders due today.

Send `reset` to clear the conversation history, `help` for the command list.

---

## Architecture

```
You (Telegram app)
      │
      ▼
Telegram servers ◄─── long-polling ───► src/telegram.js
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                  src/commands.js       node-cron jobs        src/telegram.js
                        │              (morning/evening)      (send messages)
              ┌─────────┴─────────┐
              ▼                   ▼
        src/llm.js       src/sheets.js
      (open-source LLM:      (read/write goals
       summarize news)      & logs via
                           Google Sheets API)
```

The bot uses **long-polling** — it constantly asks Telegram "any new messages?" rather than needing Telegram to call a webhook URL. This means no ngrok locally and no webhook config anywhere.

---

## Setup

### 1. Create a Telegram bot (takes ~2 minutes)

1. Open Telegram and search for **@BotFather**.
2. Send `/newbot` and follow the prompts (pick any name and username).
3. BotFather gives you a token like `7123456789:AAF_abc123...` → `TELEGRAM_BOT_TOKEN`
4. Start a chat with your new bot (search for its username and hit Start).

### 2. Find your Telegram chat ID

1. Fill in `TELEGRAM_BOT_TOKEN` in `.env` and start the server (`npm run dev`).
2. Send any message to your bot from Telegram.
3. The server logs will print: `set TELEGRAM_CHAT_ID=XXXXXXX in your .env`
4. Paste that number into `.env` as `TELEGRAM_CHAT_ID` and restart.

### 3. Google Cloud Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project.
2. Enable the **Google Sheets API** (APIs & Services → Library → search "Sheets").
3. Go to **APIs & Services → Credentials → Create Credentials → Service Account**.
4. Give it any name, click Done.
5. Click the service account → **Keys** tab → **Add Key → JSON**. Download the file.
6. Set `GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json` (or paste raw JSON inline).
7. Create a new Google Spreadsheet with four tabs, exact names:

   **DailyGoals** — row 1: `id | text | created_date | active`

   **OneoffGoals** — row 1: `id | text | done | created_date | done_date`

   **DailyLog** — row 1: `date | completed_daily_goal_ids | completed_oneoff_ids | notes | all_daily_hit`

   **NewsLog** — row 1: `date | summary_sent`

   > The server writes header rows automatically on first boot if the tabs are empty — you just need the four tabs with the right names.

8. Copy the spreadsheet ID from its URL → `GOOGLE_SHEET_ID`
9. Share the spreadsheet with the service account email (e.g. `bot@your-project.iam.gserviceaccount.com`) with **Editor** access.

### 4. LLM API Key (open-source models)

The bot talks to any OpenAI-compatible endpoint. Easiest free option: sign up at [console.groq.com](https://console.groq.com), create a key → `LLM_API_KEY` (defaults use Groq + Llama 4 Scout 17B — light and fast, with a much higher free-tier token limit than the larger 70B model). To run fully local instead, install [Ollama](https://ollama.com) and set `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=llama3.2` — no key needed.

### 5. News API Key

Choose one:
- **NewsAPI** (recommended): sign up at [newsapi.org](https://newsapi.org/register), free tier = 100 req/day → set `NEWS_API_PROVIDER=newsapi`
- **GNews**: sign up at [gnews.io](https://gnews.io), free tier = 100 req/day → set `NEWS_API_PROVIDER=gnews`

Copy your key → `NEWS_API_KEY`

---

## Running locally

```bash
# Install dependencies
npm install

# Copy and fill in env vars
cp .env.example .env
# Edit .env with real values

# Start (auto-restarts on file changes)
npm run dev
```

No ngrok needed. The bot polls Telegram directly.

---

## Deploying to Railway

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
3. Select the repo. Railway auto-detects Node.js and uses `npm start`.
4. In the **Variables** tab, add every key from `.env.example` with real values.
   - For `GOOGLE_SERVICE_ACCOUNT_JSON`: paste the entire JSON file contents as one value (Railway's UI handles multi-line).
5. Deploy — that's it. The bot stays online via Railway's persistent process.

---

## Commands

| Message | What it does |
|---|---|
| `add daily: <text>` | Add a new recurring daily goal |
| `add goal: <text>` | Add a one-off goal |
| `streak` | Show current and best streak |
| `status` or `today` | Show today's goals and which are checked off |
| `calendar` / `calendar tomorrow` | List events |
| `applications` / `applied to: <company>` / `rejected: <company>` | Job tracker |
| `news` | News digest on demand |
| `summary week\|month\|3months\|year` | Life-coach progress report |
| `reset` | Clear the agent's conversation history |
| Any other text | Goes to the AI agent — check-ins, email, scheduling, reminders, automations, research |

---

## Testing each feature

| Feature | How to test |
|---|---|
| Bot connection | Send `/start` or any message — you should get a response |
| Add a daily goal | Send `add daily: 3 leetcodes` |
| Add a one-off goal | Send `add goal: clean desk` |
| Log progress | Send `did 3 leetcodes and applied to 4 jobs` |
| Check streak | Send `streak` |
| Check today | Send `status` |
| Morning digest | Temporarily change `MORNING_DIGEST_TIME=* * * * *` (every minute), watch logs |
| Evening check-in | Same — temporarily change `EVENING_CHECKIN_TIME` |
| Email agent | Send `summarize my unread emails` (needs Gmail scope — see note below) |
| Scheduler | Send `find me a free 30 min slot tomorrow` |
| Reminder | Send `remind me in 2 minutes to stretch`, wait for the ping |
| Automation | Send `every day at 9am send me my calendar` — confirm, then check the Automations tab |
| Memory | Send `remember that I prefer morning meetings`, then `what do you remember about me?` |

> **Gmail scope**: if your `GOOGLE_CALENDAR_REFRESH_TOKEN` predates the email features, re-run `node scripts/get-calendar-token.js` — it now requests Calendar + Gmail scopes — and update the token in `.env`.

> **Sheet tabs**: the new `Memory`, `Reminders`, and `Automations` tabs are created automatically on first boot.

---

## Environment variables

See `.env.example` for the full list with inline comments.

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your personal numeric Telegram chat ID |
| `GOOGLE_SHEET_ID` | Yes | ID from the Google Spreadsheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | File path or inline JSON of service account key |
| `LLM_API_KEY` | Yes* | API key for the LLM endpoint (*not needed for local Ollama) |
| `LLM_BASE_URL` | No | OpenAI-compatible base URL (default: Groq) |
| `LLM_MODEL` | No | Model name (default: meta-llama/llama-4-scout-17b-16e-instruct) |
| `NEWS_API_KEY` | Yes | newsapi.org or gnews.io key |
| `NEWS_API_PROVIDER` | Yes | `newsapi` or `gnews` |
| `TIMEZONE` | Yes | tz name, e.g. `America/New_York` |
| `MORNING_DIGEST_TIME` | Yes | Cron expression, default `0 8 * * *` |
| `EVENING_CHECKIN_TIME` | Yes | Cron expression, default `0 21 * * *` |
| `PORT` | No | HTTP port for health check (Railway sets this) |
