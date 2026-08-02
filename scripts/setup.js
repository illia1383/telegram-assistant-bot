// Interactive setup wizard: run `npm run setup` on a fresh checkout.
// Walks through Telegram, Google (Calendar+Gmail+Sheets in one consent), the LLM
// key, and the news key, then writes .env — no Google Cloud Console, no manual
// spreadsheet building, no copy-pasting an OAuth code.

import { writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline/promises';
import TelegramBot from 'node-telegram-bot-api';
import { runLocalOAuthFlow, getOAuthClientId, getOAuthClientSecret } from '../src/google-auth.js';
import { buildEnvFile } from './env-template.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (question, { fallback = '' } = {}) => {
  const answer = (await rl.question(question)).trim();
  return answer || fallback;
};

async function step(title) {
  console.log(`\n─── ${title} ───────────────────────────────────────`);
}

async function setupTelegram() {
  await step('1. Telegram bot');
  console.log('Open Telegram, message @BotFather, send /newbot, and follow the prompts.');
  const token = await ask('Paste the bot token BotFather gave you: ');
  if (!token) throw new Error('A Telegram bot token is required.');
  return token;
}

async function detectChatId(token) {
  await step('2. Confirm it can message you');
  console.log('Search for your new bot in Telegram and send it any message now — waiting...');

  const bot = new TelegramBot(token, { polling: true });
  const chatId = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for a message — run `npm run setup` again.')), 120_000);
    bot.once('message', (msg) => {
      clearTimeout(timeout);
      resolve(String(msg.chat.id));
    });
  });
  await bot.stopPolling();
  console.log(`Got it — chat ${chatId} confirmed.`);
  return chatId;
}

async function setupGoogle() {
  await step('3. Google (Calendar + Gmail + Sheets)');
  console.log('One consent screen covers your calendar, email, and a private spreadsheet for your data.');
  console.log('Note: this app is unverified with Google, so you\'ll see a warning screen —');
  console.log('click "Advanced" then "Go to (unsafe)" to continue. This is expected.');
  if (!getOAuthClientId() || !getOAuthClientSecret()) {
    throw new Error(
      'No Google OAuth client is configured. Set GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET ' +
      'in your shell, or ask the maintainer for the shared app credentials.'
    );
  }
  const refreshToken = await runLocalOAuthFlow();
  console.log('Google authorized.');
  return refreshToken;
}

async function provisionSheet(refreshToken) {
  await step('4. Creating your data spreadsheet');
  process.env.GOOGLE_CALENDAR_REFRESH_TOKEN = refreshToken;
  const { createSpreadsheet, initializeSheets } = await import('../src/sheets.js');
  const sheetId = await createSpreadsheet();
  process.env.GOOGLE_SHEET_ID = sheetId;
  await initializeSheets();
  console.log(`Spreadsheet created: https://docs.google.com/spreadsheets/d/${sheetId}`);
  return sheetId;
}

async function setupLlm() {
  await step('5. LLM key (free)');
  console.log('Sign up at https://console.groq.com, create an API key, and paste it below.');
  const llmApiKey = await ask('Groq API key: ');
  return { llmBaseUrl: 'https://api.groq.com/openai/v1', llmModel: 'llama-3.3-70b-versatile', llmApiKey };
}

async function setupNews() {
  await step('6. News API key (free)');
  console.log('Sign up at https://newsapi.org/register for your morning news digest.');
  const newsApiKey = await ask('NewsAPI key: ');
  return { newsApiProvider: 'newsapi', newsApiKey };
}

async function setupTimezone() {
  await step('7. Timezone');
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timezone = await ask(`Detected "${detected}" — press enter to keep it, or type another tz name: `, { fallback: detected });
  return timezone;
}

async function main() {
  console.log('Telegram Assistant Bot — setup wizard\n');

  if (existsSync('.env')) {
    const overwrite = await ask('.env already exists — overwrite it? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Aborted.');
      rl.close();
      return;
    }
  }

  const telegramBotToken = await setupTelegram();
  const telegramChatId = await detectChatId(telegramBotToken);
  const refreshToken = await setupGoogle();
  const googleSheetId = await provisionSheet(refreshToken);
  const { llmBaseUrl, llmModel, llmApiKey } = await setupLlm();
  const { newsApiProvider, newsApiKey } = await setupNews();
  const timezone = await setupTimezone();

  const envContents = buildEnvFile({
    telegramBotToken,
    telegramChatId,
    googleSheetId,
    googleRefreshToken: refreshToken,
    googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    llmBaseUrl,
    llmModel,
    llmApiKey,
    newsApiProvider,
    newsApiKey,
    timezone,
    morningDigestTime: '0 8 * * *',
    eveningCheckinTime: '0 21 * * *',
    nightlyReminderTime: '50 23 * * *',
  });

  writeFileSync('.env', envContents);
  console.log('\n✅ .env written. Start the bot with `npm run dev`.');
  rl.close();
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  rl.close();
  process.exit(1);
});
