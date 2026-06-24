import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';

import { initBot, sendMessage } from './telegram.js';
import { routeMessage } from './commands.js';
import { getDailyGoals, getLogForDate, logNewsSent, initializeSheets } from './sheets.js';
import { fetchTopArticles } from './news.js';
import { summarizeNews } from './claude.js';
import { getStreaks } from './streaks.js';

// ─── Health check server (required for Railway to detect the service is up) ───

const app = express();
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── Scheduled job: Morning news digest ──────────────────────────────────────

async function sendMorningDigest() {
  console.log('[cron] Running morning digest job...');
  try {
    const articles = await fetchTopArticles();
    const digest = await summarizeNews(articles);
    await sendMessage(digest);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TIMEZONE || 'America/New_York' }).format(new Date());
    await logNewsSent(today, digest);
    console.log('[cron] Morning digest sent and logged');
  } catch (err) {
    console.error('[cron] Morning digest failed:', err.message);
  }
}

// ─── Scheduled job: Nightly logging reminder ─────────────────────────────────

async function sendNightlyReminder() {
  console.log('[cron] Running nightly reminder job...');
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TIMEZONE || 'America/New_York' }).format(new Date());
    const log = await getLogForDate(today);

    if (log?.completed_daily_goal_ids || log?.notes) {
      // Already logged something today — no need to remind
      return;
    }

    await sendMessage(`🌙 *End of day reminder*\n\nYou haven't logged anything today (${today}).\n\nWhat did you get done? Just reply and I'll log it!`);
    console.log('[cron] Nightly reminder sent');
  } catch (err) {
    console.error('[cron] Nightly reminder failed:', err.message);
  }
}

// ─── Scheduled job: Evening check-in prompt ──────────────────────────────────

async function sendEveningCheckin() {
  console.log('[cron] Running evening check-in job...');
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TIMEZONE || 'America/New_York' }).format(new Date());
    const [dailyGoals, log] = await Promise.all([
      getDailyGoals(true),
      getLogForDate(today),
    ]);

    if (log?.all_daily_hit === 'TRUE') {
      await sendMessage('🎉 You crushed all your daily goals today! Great work — rest up!');
      return;
    }

    const completedIds = new Set(
      (log?.completed_daily_goal_ids || '').split(',').filter(Boolean)
    );

    const outstanding = dailyGoals.filter(g => !completedIds.has(g.id));
    const { current } = await getStreaks();

    let msg = `⏰ *Evening Check-in*\n\nStill outstanding today:\n`;
    msg += outstanding.map(g => `⬜ ${g.text}`).join('\n');
    msg += `\n\n🔥 Current streak: ${current} day${current !== 1 ? 's' : ''}`;
    msg += `\n\nReply with what you got done!`;

    await sendMessage(msg);
    console.log('[cron] Evening check-in sent');
  } catch (err) {
    console.error('[cron] Evening check-in failed:', err.message);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function start() {
  // Initialize Google Sheets headers on first boot
  try {
    await initializeSheets();
  } catch (err) {
    console.error('[server] Sheet initialization failed (continuing anyway):', err.message);
  }

  // Start Telegram bot (long-polling — no webhook config needed)
  initBot(routeMessage);

  // Scheduled jobs
  const timezone = process.env.TIMEZONE || 'America/New_York';
  const morningTime = process.env.MORNING_DIGEST_TIME || '0 8 * * *';
  const eveningTime = process.env.EVENING_CHECKIN_TIME || '0 21 * * *';

  cron.schedule(morningTime, sendMorningDigest, { timezone });
  console.log(`[server] Morning digest scheduled: "${morningTime}" (${timezone})`);

  cron.schedule(eveningTime, sendEveningCheckin, { timezone });
  console.log(`[server] Evening check-in scheduled: "${eveningTime}" (${timezone})`);

  const nightlyTime = process.env.NIGHTLY_REMINDER_TIME || '50 23 * * *';
  cron.schedule(nightlyTime, sendNightlyReminder, { timezone });
  console.log(`[server] Nightly reminder scheduled: "${nightlyTime}" (${timezone})`);

  // Health check HTTP server
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[server] Health check listening on port ${port}`);
  });
}

start();
