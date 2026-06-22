import { sendMessage } from './telegram.js';
import { fetchTopArticles } from './news.js';
import { summarizeNews, summarizeProgress } from './claude.js';
import {
  getDailyGoals,
  getOneoffGoals,
  addDailyGoal,
  addOneoffGoal,
  markOneoffDone,
  getLogForDate,
  upsertLogForDate,
  getAllLogs,
} from './sheets.js';
import { parseCheckinMessage } from './claude.js';
import { getStreaks } from './streaks.js';

function todayString() {
  return new Date().toISOString().split('T')[0];
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

*Goals*
\`add daily: <text>\` — add a recurring daily goal
\`add goal: <text>\` — add a one-off goal

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

// ─── Command: streak ──────────────────────────────────────────────────────────

async function handleStreak() {
  const { current, best } = await getStreaks();
  const msg = `🔥 *Streak Report*\n\nCurrent streak: ${current} day${current !== 1 ? 's' : ''}\nBest streak: ${best} day${best !== 1 ? 's' : ''}`;
  await sendMessage(msg);
}

// ─── Command: status / today ──────────────────────────────────────────────────

async function handleStatus() {
  const today = todayString();
  const [dailyGoals, log] = await Promise.all([
    getDailyGoals(true),
    getLogForDate(today),
  ]);

  const completedIds = new Set(
    (log?.completed_daily_goal_ids || '').split(',').filter(Boolean)
  );

  if (dailyGoals.length === 0) {
    await sendMessage('You have no active daily goals. Add one with `add daily: <goal text>`.');
    return;
  }

  const lines = dailyGoals.map(g =>
    completedIds.has(g.id) ? `✅ ${g.text}` : `⬜ ${g.text}`
  );

  const allDone = dailyGoals.every(g => completedIds.has(g.id));
  const { current } = await getStreaks();

  let msg = `📋 *Today's Goals (${today})*\n\n${lines.join('\n')}\n\n🔥 Streak: ${current} day${current !== 1 ? 's' : ''}`;
  if (allDone) msg += '\n\n🎉 All daily goals completed!';

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
