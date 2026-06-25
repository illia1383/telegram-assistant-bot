import { sendMessage } from './telegram.js';
import { addApplication, updateStatus, getApplications } from './jobs.js';
import { fetchTopArticles } from './news.js';
import { summarizeNews, summarizeProgress } from './claude.js';
import {
  getDailyGoals,
  getOneoffGoals,
  addDailyGoal,
  addOneoffGoal,
  removeDailyGoal,
  removeOneoffGoal,
  markOneoffDone,
  getLogForDate,
  upsertLogForDate,
  getAllLogs,
} from './sheets.js';
import { parseCheckinMessage } from './claude.js';
import { getStreaks } from './streaks.js';

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

  await sendMessage(`Generating your ${period.label.toLowerCase()} summary...`);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - period.days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const [allLogs, dailyGoals, allOneoffs] = await Promise.all([
    getAllLogs(),
    getDailyGoals(false), // include inactive so we can map old IDs
    getOneoffGoals(false),
  ]);

  const logs = allLogs.filter(l => l.date >= cutoffStr);
  const completedOneoffs = allOneoffs.filter(
    g => g.done === 'TRUE' && g.done_date >= cutoffStr
  );

  if (logs.length === 0 && completedOneoffs.length === 0) {
    await sendMessage(`No data found for ${period.label.toLowerCase()} yet. Start logging and check back!`);
    return;
  }

  const summary = await summarizeProgress(period.label, logs, dailyGoals, completedOneoffs);
  await sendMessage(summary);
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
  const msg = `*Available commands:*

*Logging*
Just type what you did — e.g. "did 3 leetcodes and applied to 2 jobs"

*Jobs*
\`applied to: <company>\` — log a new job application
\`rejected: <company>\` — mark an application as rejected
\`applications\` — view all applications by status

*Goals*
\`add daily: <text>\` — add a recurring daily goal
\`add goal: <text>\` — add a one-off goal
\`remove daily: <text>\` — remove a daily goal (exact name)
\`remove goal: <text>\` — remove a one-off goal (exact name)

*Check in*
\`status\` or \`today\` — see today's goals and progress
\`streak\` — see your current and best streak

*News*
\`news\` — fetch the latest news digest on demand

*Summary*
\`summary week\` — progress over the last 7 days
\`summary month\` — progress over the last 30 days
\`summary 3months\` — progress over the last 3 months
\`summary year\` — progress over the last year

*Help*
\`help\` — show this message`;
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

// ─── Check-in: free-text parsing via Claude ───────────────────────────────────

async function handleCheckin(userMessage) {
  const today = todayString();

  const [dailyGoals, oneoffGoals, existingLog] = await Promise.all([
    getDailyGoals(true),
    getOneoffGoals(true),
    getLogForDate(today),
  ]);

  console.log('[commands] Parsing check-in message with Claude...');
  const parsed = await parseCheckinMessage(userMessage, dailyGoals, oneoffGoals);

  if (!parsed) {
    await sendMessage(
      "I had trouble understanding that. Could you be more specific? For example: \"did 3 leetcodes, applied to 2 jobs, finished resume\""
    );
    return;
  }

  // Merge with any existing log entries for today
  const existingDailyIds = (existingLog?.completed_daily_goal_ids || '').split(',').filter(Boolean);
  const existingOneoffIds = (existingLog?.completed_oneoff_ids || '').split(',').filter(Boolean);

  const mergedDailyIds = [...new Set([...existingDailyIds, ...parsed.completed_daily_goal_ids])];
  const mergedOneoffIds = [...new Set([...existingOneoffIds, ...parsed.completed_oneoff_ids])];

  const allDailyHit = dailyGoals.every(g => mergedDailyIds.includes(g.id));

  await upsertLogForDate(today, {
    completed_daily_goal_ids: mergedDailyIds.join(','),
    completed_oneoff_ids: mergedOneoffIds.join(','),
    notes: parsed.notes,
    all_daily_hit: allDailyHit,
  });

  for (const id of parsed.completed_oneoff_ids) {
    await markOneoffDone(id);
  }

  // Build confirmation message
  const completedDailyNames = dailyGoals
    .filter(g => parsed.completed_daily_goal_ids.includes(g.id))
    .map(g => `✅ ${g.text}`);

  const completedOneoffNames = oneoffGoals
    .filter(g => parsed.completed_oneoff_ids.includes(g.id))
    .map(g => `✅ ${g.text}`);

  const { current } = await getStreaks();

  let msg = `Logged for ${today}! 📝\n`;

  if (completedDailyNames.length > 0) {
    msg += `\n*Daily goals:*\n${completedDailyNames.join('\n')}`;
  }
  if (completedOneoffNames.length > 0) {
    msg += `\n\n*One-off goals:*\n${completedOneoffNames.join('\n')}`;
  }
  if (completedDailyNames.length === 0 && completedOneoffNames.length === 0) {
    msg += '\n(No goals matched — try being more specific.)';
  }

  msg += `\n\n🔥 Streak: ${current} day${current !== 1 ? 's' : ''}`;
  if (allDailyHit) msg += '\n🎉 All daily goals hit today!';

  await sendMessage(msg);
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
  // Fall through to Claude check-in parser
  await handleCheckin(text);
}
