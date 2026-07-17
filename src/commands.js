import { sendMessage } from './telegram.js';
import { addApplication, updateStatus, getApplications } from './jobs.js';
import { fetchTopArticles } from './news.js';
import { summarizeNews, summarizeProgress } from './llm.js';
import { getEventsForDate, createEvent, formatEventsMessage } from './calendar.js';
import {
  getDailyGoals,
  getOneoffGoals,
  addDailyGoal,
  addOneoffGoal,
  removeDailyGoal,
  removeOneoffGoal,
  getLogForDate,
  getAllLogs,
} from './sheets.js';
import { getStreaks } from './streaks.js';
import { runAgent, resetConversation } from './agent.js';

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ─── Command: summary ────────────────────────────────────────────────────────

const PERIODS = {
  week:   { days: 7,   label: 'Last 7 days' },
  month:  { days: 30,  label: 'Last 30 days' },
  '3months': { days: 90, label: 'Last 3 months' },
  year:   { days: 365, label: 'Last year' },
};

function parsePeriod(text) {
  const t = text.replace(/^summary\s*/i, '').trim().toLowerCase();
  if (!t || t === 'week' || t === '1w' || t === '7d')      return PERIODS.week;
  if (t === 'month' || t === '1m' || t === '30d')           return PERIODS.month;
  if (t === '3months' || t === '3m' || t === '3 months')    return PERIODS['3months'];
  if (t === 'year' || t === '1y' || t === '365d')           return PERIODS.year;
  return null;
}

async function handleSummary(text) {
  const period = parsePeriod(text);
  if (!period) {
    await sendMessage('Usage: `summary week`, `summary month`, `summary 3months`, or `summary year`');
    return;
  }

  await sendMessage(`Analyzing your ${period.label.toLowerCase()}... This may take a moment.`);

  const tz = process.env.TIMEZONE || 'America/New_York';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period.days);
  const cutoffStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(cutoff);

  // Pull all data sources in parallel
  const [allLogs, dailyGoals, allOneoffs, applications] = await Promise.all([
    getAllLogs(),
    getDailyGoals(false),
    getOneoffGoals(false),
    getApplications().catch(() => []),
  ]);

  const logs = allLogs.filter(l => l.date >= cutoffStr);
  const completedOneoffs = allOneoffs.filter(g => g.done === 'TRUE' && g.done_date >= cutoffStr);

  // Fetch calendar events for each logged day
  let calendarEvents = [];
  try {
    const { getEventsForDate } = await import('./calendar.js');
    const uniqueDates = [...new Set(logs.map(l => l.date))];
    const eventsByDay = await Promise.all(
      uniqueDates.map(async date => {
        const events = await getEventsForDate(date).catch(() => []);
        return events.map(e => ({ ...e, date }));
      })
    );
    calendarEvents = eventsByDay.flat();
  } catch {
    // Calendar not configured — skip silently
  }

  if (logs.length === 0 && completedOneoffs.length === 0 && applications.length === 0) {
    await sendMessage(`No data found for ${period.label.toLowerCase()} yet. Start logging and check back!`);
    return;
  }

  const summary = await summarizeProgress(period.label, logs, dailyGoals, completedOneoffs, allOneoffs, applications, calendarEvents);

  // Telegram has a 4096 char limit — split if needed
  if (summary.length <= 4096) {
    await sendMessage(summary);
  } else {
    const mid = summary.lastIndexOf('\n', 4000);
    await sendMessage(summary.slice(0, mid));
    await sendMessage(summary.slice(mid).trim());
  }
}

// ─── Commands: calendar ───────────────────────────────────────────────────────

function todayOffset(days) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const d = new Date();
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
}

async function handleCalendar(text) {
  const lower = text.toLowerCase();
  const isTomorrow = lower.includes('tomorrow');
  const date = isTomorrow ? todayOffset(1) : todayOffset(0);
  const label = isTomorrow ? "Tomorrow's Calendar" : "Today's Calendar";

  const events = await getEventsForDate(date);
  await sendMessage(formatEventsMessage(events, label));
}

async function handleAddEvent(text) {
  // Expected format: add event: <title> on <date> at <start> to <end>
  // Example: add event: dentist on 2026-07-10 at 2:00pm to 3:00pm
  const body = text.replace(/^add\s+event\s*:\s*/i, '').trim();

  const match = body.match(/^(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2}(?:am|pm)?)\s+to\s+(\d{1,2}:\d{2}(?:am|pm)?)$/i);
  if (!match) {
    await sendMessage(
      'Format: `add event: <title> on YYYY-MM-DD at <start> to <end>`\nExample: `add event: Dentist on 2026-07-10 at 2:00pm to 3:00pm`'
    );
    return;
  }

  const [, title, date, startRaw, endRaw] = match;

  function to24h(t) {
    const [time, meridiem] = t.toLowerCase().split(/(am|pm)/);
    let [h, m] = time.split(':').map(Number);
    if (meridiem === 'pm' && h !== 12) h += 12;
    if (meridiem === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
  }

  await createEvent({ title, date, startTime: to24h(startRaw), endTime: to24h(endRaw) });
  await sendMessage(`Added to calendar: *${title}*\n📅 ${date} · ${startRaw} – ${endRaw} ✅`);
}

// ─── Commands: job application tracker ───────────────────────────────────────

async function handleApplied(text) {
  const body = text.replace(/^applied\s+to\s*:\s*/i, '').trim();
  if (!body) {
    await sendMessage('Usage: `applied to: <company name>`');
    return;
  }
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TIMEZONE || 'America/New_York',
  }).format(new Date());
  await addApplication(body, date);
  await sendMessage(`Logged application to *${body}* on ${date} ✅\nStatus set to: Waiting`);
}

async function handleReject(text) {
  const company = text.replace(/^rejected\s*:\s*/i, '').trim();
  if (!company) {
    await sendMessage('Usage: `rejected: <company name>`');
    return;
  }
  const updated = await updateStatus(company, 'Rejected');
  if (updated) {
    await sendMessage(`Updated *${company}* → Rejected ❌`);
  } else {
    await sendMessage(`No application found for "${company}". Check the exact company name with \`applications\`.`);
  }
}

async function handleApplications() {
  const apps = await getApplications();
  if (apps.length === 0) {
    await sendMessage('No applications logged yet. Add one with `applied to: <company>`.');
    return;
  }

  const waiting = apps.filter(a => a.status.toLowerCase() === 'waiting');
  const rejected = apps.filter(a => a.status.toLowerCase() === 'rejected');

  let msg = `📋 *Job Applications (${apps.length} total)*\n`;

  if (waiting.length > 0) {
    msg += `\n*Waiting (${waiting.length}):*\n`;
    msg += waiting.map(a => `⏳ ${a.company} — ${a.dateApplied}`).join('\n');
  }
  if (rejected.length > 0) {
    msg += `\n\n*Rejected (${rejected.length}):*\n`;
    msg += rejected.map(a => `❌ ${a.company}`).join('\n');
  }

  await sendMessage(msg);
}

// ─── Command: news ───────────────────────────────────────────────────────────

async function handleNews() {
  await sendMessage('Fetching the latest news...');
  const articles = await fetchTopArticles();
  const digest = await summarizeNews(articles);
  await sendMessage(digest);
}

// ─── Command: help ───────────────────────────────────────────────────────────

async function handleHelp() {
  const msg = `*Your AI Assistant* 🤖

Just talk to me naturally — I can handle things like:
• "What's on my calendar Thursday?" / "Move my dentist appt to 4pm"
• "Find me a free 30-min slot tomorrow"
• "Summarize my unread emails" / "Draft a reply to the recruiter"
• "Remind me at 5pm to call mom"
• "Every weekday at 7am, send me my email summary" (automations)
• "Remember that I prefer morning meetings"
• "Did 3 leetcodes and applied to 2 jobs" (logs your goals)
• "What's the latest on <anything>?" (web research)

*Quick commands*
\`status\` / \`today\` — today's goals · \`streak\` — streaks
\`calendar\` / \`calendar tomorrow\` — events
\`applications\` — job apps · \`applied to: <company>\` · \`rejected: <company>\`
\`add daily: <text>\` · \`add goal: <text>\` · \`remove daily/goal: <text>\`
\`news\` — news digest
\`summary week|month|3months|year\` — progress reports
\`reset\` — start a fresh conversation
\`help\` — this message`;
  await sendMessage(msg);
}

// ─── Command: add daily goal ──────────────────────────────────────────────────

async function handleAddDaily(text) {
  const goalText = text.replace(/^add\s+daily\s*:\s*/i, '').trim();
  if (!goalText) {
    await sendMessage('Please provide the goal text after "add daily:". Example: `add daily: 3 leetcodes`');
    return;
  }
  const goal = await addDailyGoal(goalText);
  await sendMessage(`Added daily goal: "${goal.text}" ✅`);
}

// ─── Command: add one-off goal ────────────────────────────────────────────────

async function handleAddGoal(text) {
  const goalText = text.replace(/^add\s+goal\s*:\s*/i, '').trim();
  if (!goalText) {
    await sendMessage('Please provide the goal text after "add goal:". Example: `add goal: rewrite resume`');
    return;
  }
  const goal = await addOneoffGoal(goalText);
  await sendMessage(`Added one-off goal: "${goal.text}" 📌`);
}

// ─── Command: remove daily goal ──────────────────────────────────────────────

async function handleRemoveDaily(text) {
  const goalText = text.replace(/^remove\s+daily\s*:\s*/i, '').trim();
  if (!goalText) {
    await sendMessage('Usage: `remove daily: <exact goal text>`');
    return;
  }
  const removed = await removeDailyGoal(goalText);
  if (removed) {
    await sendMessage(`Removed daily goal: "${goalText}" ✅`);
  } else {
    await sendMessage(`No active daily goal found with that exact name: "${goalText}"\n\nSend \`status\` to see your current goals.`);
  }
}

// ─── Command: remove one-off goal ────────────────────────────────────────────

async function handleRemoveGoal(text) {
  const goalText = text.replace(/^remove\s+goal\s*:\s*/i, '').trim();
  if (!goalText) {
    await sendMessage('Usage: `remove goal: <exact goal text>`');
    return;
  }
  const result = await removeOneoffGoal(goalText);
  if (result.removed) {
    await sendMessage(`Removed one-off goal: "${goalText}" ✅`);
  } else if (result.alreadyDone) {
    await sendMessage(`"${goalText}" is already marked as done — it can't be removed.`);
  } else {
    await sendMessage(`No pending one-off goal found with that exact name: "${goalText}"\n\nSend \`status\` to see your current goals.`);
  }
}

// ─── Command: streak ──────────────────────────────────────────────────────────

async function handleStreak() {
  const { current, best } = await getStreaks();
  const msg = `🔥 *Streak Report*\n\nCurrent streak: ${current} day${current !== 1 ? 's' : ''}\nBest streak: ${best} day${best !== 1 ? 's' : ''}`;
  await sendMessage(msg);
}

// ─── Command: status / today ──────────────────────────────────────────────────

async function handleStatus() {
  const today = todayString();
  const [dailyGoals, oneoffGoals, log] = await Promise.all([
    getDailyGoals(true),
    getOneoffGoals(true),
    getLogForDate(today),
  ]);

  const completedDailyIds = new Set(
    (log?.completed_daily_goal_ids || '').split(',').filter(Boolean)
  );
  const completedOneoffIds = new Set(
    (log?.completed_oneoff_ids || '').split(',').filter(Boolean)
  );

  if (dailyGoals.length === 0 && oneoffGoals.length === 0) {
    await sendMessage('You have no active goals. Add one with `add daily: <text>` or `add goal: <text>`.');
    return;
  }

  let msg = `📋 *Today's Goals (${today})*\n`;

  if (dailyGoals.length > 0) {
    const lines = dailyGoals.map(g =>
      completedDailyIds.has(g.id) ? `✅ ${g.text}` : `⬜ ${g.text}`
    );
    msg += `\n*Daily:*\n${lines.join('\n')}`;
  }

  if (oneoffGoals.length > 0) {
    const lines = oneoffGoals.map(g =>
      completedOneoffIds.has(g.id) ? `✅ ${g.text}` : `⬜ ${g.text}`
    );
    msg += `\n\n*One-off:*\n${lines.join('\n')}`;
  }

  const allDailyDone = dailyGoals.every(g => completedDailyIds.has(g.id));
  const { current } = await getStreaks();

  msg += `\n\n🔥 Streak: ${current} day${current !== 1 ? 's' : ''}`;
  if (allDailyDone && dailyGoals.length > 0) msg += '\n\n🎉 All daily goals completed!';

  await sendMessage(msg);
}

// ─── Everything else: the conversational AI agent ─────────────────────────────
// Free text (check-ins, email, scheduling, reminders, research, ...) goes to the
// LLM tool-use agent, which takes real actions and replies naturally.

async function handleAgent(userMessage) {
  const reply = await runAgent(userMessage);

  // Telegram has a 4096 char limit — split if needed
  if (reply.length <= 4096) {
    await sendMessage(reply);
  } else {
    const mid = reply.lastIndexOf('\n', 4000);
    await sendMessage(reply.slice(0, mid > 0 ? mid : 4000));
    await sendMessage(reply.slice(mid > 0 ? mid : 4000).trim());
  }
}

// ─── Main router ──────────────────────────────────────────────────────────────

export async function routeMessage(text) {
  if (/^summary\b/i.test(text)) {
    await handleSummary(text);
    return;
  }
  if (/^news\b/i.test(text)) {
    await handleNews();
    return;
  }
  if (/^help\b/i.test(text)) {
    await handleHelp();
    return;
  }
  if (/^calendar\b/i.test(text)) {
    await handleCalendar(text);
    return;
  }
  if (/^add\s+event\s*:/i.test(text)) {
    await handleAddEvent(text);
    return;
  }
  if (/^applied\s+to\s*:/i.test(text)) {
    await handleApplied(text);
    return;
  }
  if (/^rejected\s*:/i.test(text)) {
    await handleReject(text);
    return;
  }
  if (/^applications\b/i.test(text)) {
    await handleApplications();
    return;
  }
  if (/^remove\s+daily\s*:/i.test(text)) {
    await handleRemoveDaily(text);
    return;
  }
  if (/^remove\s+goal\s*:/i.test(text)) {
    await handleRemoveGoal(text);
    return;
  }
  if (/^add\s+daily\s*:/i.test(text)) {
    await handleAddDaily(text);
    return;
  }
  if (/^add\s+goal\s*:/i.test(text)) {
    await handleAddGoal(text);
    return;
  }
  if (/^streak\b/i.test(text)) {
    await handleStreak();
    return;
  }
  if (/^(status|today)\b/i.test(text)) {
    await handleStatus();
    return;
  }
  if (/^(reset|new chat)\b/i.test(text)) {
    resetConversation();
    await sendMessage('🧹 Fresh start! Conversation history cleared.');
    return;
  }
  // Everything else goes to the AI agent (check-ins, email, scheduling, ...)
  await handleAgent(text);
}
