import axios from 'axios';
import {
  getDailyGoals, getOneoffGoals, addDailyGoal, addOneoffGoal,
  removeDailyGoal, removeOneoffGoal, markOneoffDone,
  getLogForDate, upsertLogForDate,
} from './sheets.js';
import { getStreaks } from './streaks.js';
import {
  getEventsForDate, getEventsForRange, createEvent, updateEvent,
  deleteEvent, findFreeSlots,
} from './calendar.js';
import {
  listEmails, readEmail, createDraft, sendEmail, archiveEmail, markRead,
} from './gmail.js';
import { addReminder, getReminders, cancelReminder } from './reminders.js';
import { addMemory, getMemories, forgetMemory } from './memory.js';
import { createAutomation, getAutomations, deleteAutomation } from './automations.js';
import { addApplication, updateStatus, getApplications } from './jobs.js';
import { fetchTopArticles } from './news.js';

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// Keyless web search: DuckDuckGo instant answers, Wikipedia fallback.
async function webSearch(query) {
  const results = [];
  try {
    const res = await axios.get('https://api.duckduckgo.com/', {
      params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
      timeout: 10_000,
    });
    const d = res.data;
    if (d.AbstractText) results.push({ title: d.Heading, snippet: d.AbstractText, url: d.AbstractURL });
    for (const t of (d.RelatedTopics || []).slice(0, 5)) {
      if (t.Text) results.push({ title: t.Text.slice(0, 80), snippet: t.Text, url: t.FirstURL });
    }
  } catch { /* fall through to Wikipedia */ }

  if (results.length === 0) {
    const res = await axios.get('https://en.wikipedia.org/w/api.php', {
      params: { action: 'opensearch', search: query, limit: 5, format: 'json' },
      timeout: 10_000,
    });
    const [, titles, descriptions, urls] = res.data;
    titles.forEach((t, i) => results.push({ title: t, snippet: descriptions[i], url: urls[i] }));
  }
  return { query, results };
}

const def = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const TOOLS = [
  def('get_today_status', 'Get active daily goals, pending one-off goals, and what has been completed today (with goal IDs). Call before logging accomplishments.'),
  def('log_accomplishments', 'Log completed goals for today using goal IDs from get_today_status.', {
    daily_goal_ids: { type: 'array', items: { type: 'string' } },
    oneoff_goal_ids: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string', description: 'One-sentence summary of what was accomplished' },
  }, ['daily_goal_ids', 'oneoff_goal_ids', 'notes']),
  def('add_goal', 'Add a goal. Daily goals recur every day; one-off goals are single tasks.', {
    text: { type: 'string' },
    type: { type: 'string', enum: ['daily', 'oneoff'] },
  }, ['text', 'type']),
  def('remove_goal', 'Remove a goal by its exact text.', {
    text: { type: 'string' },
    type: { type: 'string', enum: ['daily', 'oneoff'] },
  }, ['text', 'type']),
  def('get_streaks', 'Get current and best daily-goal streaks.'),

  def('get_calendar_events', 'List calendar events between two dates (inclusive). Returns event IDs for update/delete.', {
    start_date: { type: 'string', description: 'YYYY-MM-DD' },
    end_date: { type: 'string', description: 'YYYY-MM-DD' },
  }, ['start_date', 'end_date']),
  def('create_calendar_event', 'Create a calendar event.', {
    title: { type: 'string' },
    date: { type: 'string', description: 'YYYY-MM-DD' },
    start_time: { type: 'string', description: 'HH:MM 24-hour' },
    end_time: { type: 'string', description: 'HH:MM 24-hour' },
    location: { type: 'string' },
    description: { type: 'string' },
  }, ['title', 'date', 'start_time', 'end_time']),
  def('update_calendar_event', 'Reschedule or edit an event. Get event_id from get_calendar_events first.', {
    event_id: { type: 'string' },
    title: { type: 'string' },
    date: { type: 'string' },
    start_time: { type: 'string' },
    end_time: { type: 'string' },
    location: { type: 'string' },
  }, ['event_id']),
  def('delete_calendar_event', 'Delete a calendar event. Confirm with the user first unless they explicitly asked.', {
    event_id: { type: 'string' },
  }, ['event_id']),
  def('find_free_slots', 'Find open time windows on a day for scheduling.', {
    date: { type: 'string', description: 'YYYY-MM-DD' },
    duration_minutes: { type: 'number', description: 'Default 30' },
    earliest: { type: 'string', description: 'HH:MM, default 09:00' },
    latest: { type: 'string', description: 'HH:MM, default 18:00' },
  }, ['date']),

  def('list_emails', 'List/search emails with Gmail query syntax (e.g. "is:unread", "from:linkedin.com newer_than:7d").', {
    query: { type: 'string', description: 'Default "in:inbox"' },
    max_results: { type: 'number', description: 'Default 10, max 25' },
  }),
  def('read_email', 'Read the full body of an email by ID.', {
    email_id: { type: 'string' },
  }, ['email_id']),
  def('draft_email', 'Create a Gmail draft (NOT sent — user reviews in Gmail). For replies pass reply_to_email_id; to/subject are inferred. Prefer this over send_email.', {
    to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    reply_to_email_id: { type: 'string' },
  }, ['body']),
  def('send_email', 'Send an email immediately. ONLY after the user saw the exact content and confirmed sending.', {
    to: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    reply_to_email_id: { type: 'string' },
  }, ['body']),
  def('archive_email', 'Archive an email (remove from inbox).', { email_id: { type: 'string' } }, ['email_id']),
  def('mark_email_read', 'Mark an email as read.', { email_id: { type: 'string' } }, ['email_id']),

  def('add_reminder', 'Schedule a one-off reminder. Convert relative times to ISO using the current date/time in the system prompt.', {
    text: { type: 'string' },
    due_iso: { type: 'string', description: 'ISO 8601 with offset, e.g. 2026-07-17T09:00:00-04:00' },
  }, ['text', 'due_iso']),
  def('list_reminders', 'List pending reminders with IDs.'),
  def('cancel_reminder', 'Cancel a pending reminder by ID.', { reminder_id: { type: 'string' } }, ['reminder_id']),

  def('remember', 'Save a lasting fact/preference about the user. Use proactively when they state preferences or correct you.', {
    fact: { type: 'string' },
    category: { type: 'string', description: 'preference | personal | work | style' },
  }, ['fact']),
  def('forget_memory', 'Delete a remembered fact by ID.', { memory_id: { type: 'string' } }, ['memory_id']),
  def('list_memories', 'List everything remembered about the user, with IDs.'),

  def('create_automation', 'Create a recurring automation: on a cron schedule, the prompt runs through this assistant and the result is messaged to the user. Confirm schedule before creating.', {
    description: { type: 'string', description: 'Short name' },
    cron: { type: 'string', description: '5-field cron expression' },
    prompt: { type: 'string' },
  }, ['description', 'cron', 'prompt']),
  def('list_automations', 'List active automations with IDs and schedules.'),
  def('delete_automation', 'Deactivate an automation by ID.', { automation_id: { type: 'string' } }, ['automation_id']),

  def('add_job_application', 'Log a new job application (status Waiting).', { company: { type: 'string' } }, ['company']),
  def('update_job_status', 'Update a job application status (Rejected, Interview, Offer, ...).', {
    company: { type: 'string' },
    status: { type: 'string' },
  }, ['company', 'status']),
  def('list_job_applications', 'List all job applications with statuses.'),

  def('get_news_headlines', 'Fetch latest top tech news headlines.'),
  def('web_search', 'Search the web for facts or current topics.', { query: { type: 'string' } }, ['query']),
];

// ─── Tool selection ────────────────────────────────────────────────────────────
// Sending all ~30 tool schemas on every request costs ~2000+ tokens before the
// model even answers, which blows through Groq's free-tier TPM limit fast.
// Only send the goal/search core (always relevant — check-ins and open
// questions are the most common free text) plus whichever categories the
// message's keywords suggest are actually needed.

const CORE_TOOL_NAMES = [
  'get_today_status', 'log_accomplishments', 'add_goal', 'remove_goal', 'get_streaks',
  'get_news_headlines', 'web_search',
];

const TOOL_CATEGORIES = [
  {
    keywords: ['calendar', 'meeting', 'schedule', 'event', 'appointment', 'slot', 'reschedule', 'book'],
    tools: ['get_calendar_events', 'create_calendar_event', 'update_calendar_event', 'delete_calendar_event', 'find_free_slots'],
  },
  {
    keywords: ['email', 'gmail', 'inbox', 'draft', 'reply', 'recruiter', 'unread'],
    tools: ['list_emails', 'read_email', 'draft_email', 'send_email', 'archive_email', 'mark_email_read'],
  },
  {
    keywords: ['remind'],
    tools: ['add_reminder', 'list_reminders', 'cancel_reminder'],
  },
  {
    keywords: ['remember', 'forget', 'memory', 'memories', 'prefer'],
    tools: ['remember', 'forget_memory', 'list_memories'],
  },
  {
    keywords: ['automat', 'every day', 'every week', 'every weekday', 'cron', 'recurring'],
    tools: ['create_automation', 'list_automations', 'delete_automation'],
  },
  {
    keywords: ['job', 'application', 'applied', 'interview', 'offer', 'rejected'],
    tools: ['add_job_application', 'update_job_status', 'list_job_applications'],
  },
];

export function selectTools(message) {
  const lower = message.toLowerCase();
  const names = new Set(CORE_TOOL_NAMES);
  for (const { keywords, tools } of TOOL_CATEGORIES) {
    if (keywords.some(kw => lower.includes(kw))) {
      for (const t of tools) names.add(t);
    }
  }
  return TOOLS.filter(t => names.has(t.function.name));
}

export const EXECUTORS = {
  async get_today_status() {
    const today = todayString();
    const [dailyGoals, oneoffGoals, log, streaks] = await Promise.all([
      getDailyGoals(true), getOneoffGoals(true), getLogForDate(today), getStreaks(),
    ]);
    return {
      date: today,
      daily_goals: dailyGoals.map(g => ({ id: g.id, text: g.text })),
      oneoff_goals: oneoffGoals.map(g => ({ id: g.id, text: g.text })),
      completed_daily_ids: (log?.completed_daily_goal_ids || '').split(',').filter(Boolean),
      completed_oneoff_ids: (log?.completed_oneoff_ids || '').split(',').filter(Boolean),
      notes: log?.notes || '',
      streak: streaks,
    };
  },

  async log_accomplishments({ daily_goal_ids = [], oneoff_goal_ids = [], notes = '' }) {
    const today = todayString();
    const [dailyGoals, existingLog] = await Promise.all([getDailyGoals(true), getLogForDate(today)]);

    const mergedDaily = [...new Set([
      ...(existingLog?.completed_daily_goal_ids || '').split(',').filter(Boolean),
      ...daily_goal_ids,
    ])];
    const mergedOneoff = [...new Set([
      ...(existingLog?.completed_oneoff_ids || '').split(',').filter(Boolean),
      ...oneoff_goal_ids,
    ])];
    const allDailyHit = dailyGoals.every(g => mergedDaily.includes(g.id));

    await upsertLogForDate(today, {
      completed_daily_goal_ids: mergedDaily.join(','),
      completed_oneoff_ids: mergedOneoff.join(','),
      notes,
      all_daily_hit: allDailyHit,
    });
    for (const id of oneoff_goal_ids) await markOneoffDone(id);
    return { logged: true, all_daily_hit: allDailyHit, streak: await getStreaks() };
  },

  async add_goal({ text, type }) {
    const goal = type === 'daily' ? await addDailyGoal(text) : await addOneoffGoal(text);
    return { added: goal.text, type };
  },

  async remove_goal({ text, type }) {
    if (type === 'daily') return { removed: await removeDailyGoal(text) };
    return await removeOneoffGoal(text);
  },

  async get_streaks() {
    return await getStreaks();
  },

  async get_calendar_events({ start_date, end_date }) {
    const events = start_date === end_date
      ? (await getEventsForDate(start_date)).map(e => ({ ...e, date: start_date }))
      : await getEventsForRange(start_date, end_date);
    return { events };
  },

  async create_calendar_event({ title, date, start_time, end_time, location, description }) {
    const event = await createEvent({ title, date, startTime: start_time, endTime: end_time, location, description });
    return { created: true, event_id: event.id, title, date, start_time, end_time };
  },

  async update_calendar_event({ event_id, title, date, start_time, end_time, location }) {
    await updateEvent(event_id, { title, date, startTime: start_time, endTime: end_time, location });
    return { updated: true };
  },

  async delete_calendar_event({ event_id }) {
    return { deleted: await deleteEvent(event_id) };
  },

  async find_free_slots({ date, duration_minutes, earliest, latest }) {
    const slots = await findFreeSlots(date, duration_minutes ?? 30, earliest ?? '09:00', latest ?? '18:00');
    return { date, free_slots: slots };
  },

  async list_emails({ query, max_results } = {}) {
    return { emails: await listEmails({ query: query || 'in:inbox', maxResults: Math.min(max_results ?? 10, 25) }) };
  },

  async read_email({ email_id }) {
    return await readEmail(email_id);
  },

  async draft_email({ to, subject, body, reply_to_email_id }) {
    return await createDraft({ to, subject, body, replyToEmailId: reply_to_email_id ?? null });
  },

  async send_email({ to, subject, body, reply_to_email_id }) {
    return await sendEmail({ to, subject, body, replyToEmailId: reply_to_email_id ?? null });
  },

  async archive_email({ email_id }) {
    return { archived: await archiveEmail(email_id) };
  },

  async mark_email_read({ email_id }) {
    return { marked_read: await markRead(email_id) };
  },

  async add_reminder({ text, due_iso }) {
    return await addReminder(text, due_iso);
  },

  async list_reminders() {
    return { reminders: await getReminders(true) };
  },

  async cancel_reminder({ reminder_id }) {
    return { cancelled: await cancelReminder(reminder_id) };
  },

  async remember({ fact, category }) {
    return await addMemory(fact, category ?? 'general');
  },

  async forget_memory({ memory_id }) {
    return { forgotten: await forgetMemory(memory_id) };
  },

  async list_memories() {
    return { memories: await getMemories() };
  },

  async create_automation({ description, cron, prompt }) {
    return await createAutomation(description, cron, prompt);
  },

  async list_automations() {
    return { automations: await getAutomations(true) };
  },

  async delete_automation({ automation_id }) {
    return { deleted: await deleteAutomation(automation_id) };
  },

  async add_job_application({ company }) {
    await addApplication(company, todayString());
    return { logged: company, status: 'Waiting' };
  },

  async update_job_status({ company, status }) {
    return { updated: await updateStatus(company, status) };
  },

  async list_job_applications() {
    return { applications: await getApplications() };
  },

  async get_news_headlines() {
    return { articles: (await fetchTopArticles()).slice(0, 10) };
  },

  async web_search({ query }) {
    return await webSearch(query);
  },
};
