# Telegram Assistant Bot

A personal accountability + assistant bot you text on Telegram. Tracks daily recurring goals, one-off goals, sends a morning news digest, and an evening check-in. All data lives in a Google Sheet.

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
        src/claude.js       src/sheets.js
      (parse intent,      (read/write goals
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

### 4. Anthropic API Key

Sign up at [console.anthropic.com](https://console.anthropic.com), create a key → `ANTHROPIC_API_KEY`

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
| Any other text | Claude parses it as a check-in and logs completed goals |

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

---

## Environment variables

See `.env.example` for the full list with inline comments.

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your personal numeric Telegram chat ID |
| `GOOGLE_SHEET_ID` | Yes | ID from the Google Spreadsheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | File path or inline JSON of service account key |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `NEWS_API_KEY` | Yes | newsapi.org or gnews.io key |
| `NEWS_API_PROVIDER` | Yes | `newsapi` or `gnews` |
| `TIMEZONE` | Yes | tz name, e.g. `America/New_York` |
| `MORNING_DIGEST_TIME` | Yes | Cron expression, default `0 8 * * *` |
| `EVENING_CHECKIN_TIME` | Yes | Cron expression, default `0 21 * * *` |
| `PORT` | No | HTTP port for health check (Railway sets this) |
