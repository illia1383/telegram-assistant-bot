// Pure .env file builder — kept separate from scripts/setup.js's interactive I/O
// so it's unit-testable without stubbing readline/network/filesystem.

const LINES = [
  ['# ─── Telegram ─────────────────────────────────────────────────────────────', null],
  ['TELEGRAM_BOT_TOKEN', 'telegramBotToken'],
  ['TELEGRAM_CHAT_ID', 'telegramChatId'],
  ['', null],
  ['# ─── Google (Calendar, Gmail, Sheets — one OAuth consent covers all three) ──', null],
  ['GOOGLE_SHEET_ID', 'googleSheetId'],
  ['GOOGLE_CALENDAR_REFRESH_TOKEN', 'googleRefreshToken'],
  ['GOOGLE_OAUTH_CLIENT_ID', 'googleOAuthClientId'],
  ['GOOGLE_OAUTH_CLIENT_SECRET', 'googleOAuthClientSecret'],
  ['', null],
  ['# ─── LLM (open-source models, OpenAI-compatible API) ─────────────────────────', null],
  ['LLM_BASE_URL', 'llmBaseUrl'],
  ['LLM_MODEL', 'llmModel'],
  ['LLM_API_KEY', 'llmApiKey'],
  ['', null],
  ['# ─── News API ────────────────────────────────────────────────────────────────', null],
  ['NEWS_API_PROVIDER', 'newsApiProvider'],
  ['NEWS_API_KEY', 'newsApiKey'],
  ['', null],
  ['# ─── Scheduling ──────────────────────────────────────────────────────────────', null],
  ['TIMEZONE', 'timezone'],
  ['MORNING_DIGEST_TIME', 'morningDigestTime'],
  ['EVENING_CHECKIN_TIME', 'eveningCheckinTime'],
  ['NIGHTLY_REMINDER_TIME', 'nightlyReminderTime'],
];

// values: plain object keyed by the second column above (e.g. telegramBotToken).
// Blank/undefined values are still written as `KEY=` so the file stays a complete,
// editable template — matches .env.example's shape.
export function buildEnvFile(values) {
  return LINES
    .map(([keyOrComment, valueKey]) =>
      valueKey === null ? keyOrComment : `${keyOrComment}=${values[valueKey] ?? ''}`
    )
    .join('\n') + '\n';
}
