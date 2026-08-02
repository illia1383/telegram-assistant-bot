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

```bash
npm install
npm run setup
```

The wizard walks through everything interactively:

1. **Telegram bot** — prompts you to create one via @BotFather (~1 minute), then confirms it can message you by waiting for your first message.
2. **Google (Calendar + Gmail + Sheets)** — opens your browser for a single sign-in. You'll see an "unverified app" warning first — click **Advanced → Go to (app) (unsafe)** to continue; this is expected for a self-hosted app and is documented further below. Approving it authorizes calendar, email, and creates a private spreadsheet under your own Google account — no manual spreadsheet building, no service account, no sharing steps.
3. **LLM key** — prompts for a free [Groq](https://console.groq.com) API key.
4. **News key** — prompts for a free [NewsAPI](https://newsapi.org/register) key.
5. **Timezone** — auto-detected, confirm or override.

It writes the result to `.env`. Then:

```bash
npm run dev
```

No ngrok needed. The bot polls Telegram directly.

### About the "unverified app" warning

This app ships with one shared Google OAuth client so nobody has to create their own Google Cloud project. Since that shared client hasn't been through Google's app verification process, every self-hoster sees an "unverified app" warning during sign-in — click through it (Advanced → Go to app (unsafe)). This is safe: it's the same client used by every copy of this app, your data goes directly from your Google account to your own bot instance, and you can revoke access anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). One caveat: while unverified, Google caps this at 100 users total across every person running this setup — if you hit that wall, see "Advanced" below.

### Advanced: bring your own Google Cloud project

If you'd rather not depend on the shared OAuth client (e.g. you're past the 100-user cap, or just prefer full control):

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create a project, and enable the **Google Calendar**, **Gmail**, and **Google Sheets** APIs.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application type: **Desktop app**.
3. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in your shell environment (or `.env`, before running setup).
4. Run `npm run setup` as usual — it'll use your credentials instead of the shared default.

---

## Deploying to Railway

Railway can't run the interactive browser-based `npm run setup` (it's a headless environment), so run setup locally first, then copy the result over:

1. `npm run setup` locally to produce a working `.env`.
2. Push this repo to GitHub.
3. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
4. Select the repo. Railway auto-detects Node.js and uses `npm start`.
5. In the **Variables** tab, copy every key from your local `.env` in.
6. Deploy — that's it. The bot stays online via Railway's persistent process.

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

> **Scopes**: if your `GOOGLE_CALENDAR_REFRESH_TOKEN` predates the email or spreadsheet-auth features, re-run `npm run setup` — it requests Calendar + Gmail + Sheets in one consent — and it'll update `.env` for you.

> **Sheet tabs**: the new `Memory`, `Reminders`, and `Automations` tabs are created automatically on first boot.

---

## Environment variables

See `.env.example` for the full list with inline comments.

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your personal numeric Telegram chat ID |
| `GOOGLE_SHEET_ID` | Yes | ID of your auto-created data spreadsheet |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | Yes | OAuth refresh token (Calendar + Gmail + Sheets) |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | No | Only needed if using your own Google Cloud project — see "Advanced" above |
| `LLM_API_KEY` | Yes* | API key for the LLM endpoint (*not needed for local Ollama) |
| `LLM_BASE_URL` | No | OpenAI-compatible base URL (default: Groq) |
| `LLM_MODEL` | No | Model name (default: llama-3.3-70b-versatile) |
| `NEWS_API_KEY` | Yes | newsapi.org or gnews.io key |
| `NEWS_API_PROVIDER` | Yes | `newsapi` or `gnews` |
| `TIMEZONE` | Yes | tz name, e.g. `America/New_York` |
| `MORNING_DIGEST_TIME` | Yes | Cron expression, default `0 8 * * *` |
| `EVENING_CHECKIN_TIME` | Yes | Cron expression, default `0 21 * * *` |
| `PORT` | No | HTTP port for health check (Railway sets this) |
