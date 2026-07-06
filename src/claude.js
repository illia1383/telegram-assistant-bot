import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIFE_COACH_PROMPT = readFileSync(join(__dirname, '../prompts/life-coach.md'), 'utf8');

const MODEL = 'claude-haiku-4-5-20251001';

let client = null;

function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// ─── parseCheckinMessage ──────────────────────────────────────────────────────
// Returns { completed_daily_goal_ids, completed_oneoff_ids, notes } or null on parse failure.

const CHECKIN_SYSTEM_PROMPT = `You are a goal-tracking assistant. The user will send a message describing what they accomplished today.
You will be given their active daily goals and pending one-off goals.
Your job is to identify which goals were completed based on what they described.

CRITICAL: You must respond with ONLY valid JSON. No preamble, no explanation, no markdown code fences.
The response must exactly match this schema:

{
  "completed_daily_goal_ids": ["array of IDs of completed daily goals"],
  "completed_oneoff_ids": ["array of IDs of completed one-off goals"],
  "notes": "a brief one-sentence summary of what was accomplished"
}

Rules:
- Be liberal in matching. If the message strongly implies a goal was completed, include it.
- Return empty arrays if nothing matches.
- IDs must come from the provided lists. Do not invent IDs.
- The "notes" field should capture the essence of what was done in plain language.`;

export async function parseCheckinMessage(message, dailyGoals, oneoffGoals) {
  const goalsContext = `
ACTIVE DAILY GOALS:
${dailyGoals.map(g => `  id="${g.id}" → ${g.text}`).join('\n') || '  (none)'}

PENDING ONE-OFF GOALS:
${oneoffGoals.map(g => `  id="${g.id}" → ${g.text}`).join('\n') || '  (none)'}

USER MESSAGE:
${message}`;

  console.log('[claude] Calling parseCheckinMessage...');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 512,
    system: CHECKIN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: goalsContext }],
  });

  const raw = response.content[0]?.text ?? '';
  console.log('[claude] Raw parseCheckinMessage response:', raw);

  // Strip markdown fences if Claude added them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (
      !Array.isArray(parsed.completed_daily_goal_ids) ||
      !Array.isArray(parsed.completed_oneoff_ids)
    ) {
      throw new Error('Schema mismatch');
    }
    return parsed;
  } catch (err) {
    console.error('[claude] Failed to parse JSON response:', err.message);
    return null;
  }
}

// ─── summarizeProgress ───────────────────────────────────────────────────────
// Deep life coach analysis using all available data sources.

export async function summarizeProgress(periodLabel, logs, dailyGoals, completedOneoffs, allOneoffs = [], applications = [], calendarEvents = []) {
  const goalMap = Object.fromEntries(dailyGoals.map(g => [g.id, g.text]));

  // Daily log breakdown
  const logLines = logs.map(l => {
    const hitGoals = (l.completed_daily_goal_ids || '').split(',').filter(Boolean).map(id => goalMap[id] || id);
    const missedGoals = dailyGoals.filter(g => !(l.completed_daily_goal_ids || '').split(',').includes(g.id)).map(g => g.text);
    return `${l.date}: completed=[${hitGoals.join(', ') || 'none'}] missed=[${missedGoals.join(', ') || 'none'}] all_hit=${l.all_daily_hit} notes="${l.notes || ''}"`;
  });

  // Goal completion rates
  const goalStats = dailyGoals.map(g => {
    const hits = logs.filter(l => (l.completed_daily_goal_ids || '').split(',').includes(g.id)).length;
    const pct = logs.length > 0 ? Math.round((hits / logs.length) * 100) : 0;
    return `  "${g.text}": completed ${hits}/${logs.length} days (${pct}%)`;
  });

  // Pending one-off goals (not yet done)
  const pendingOneoffs = allOneoffs.filter(g => g.done !== 'TRUE');

  // Job applications breakdown
  const waiting = applications.filter(a => a.status?.toLowerCase() === 'waiting');
  const rejected = applications.filter(a => a.status?.toLowerCase() === 'rejected');

  const context = `
ANALYSIS PERIOD: ${periodLabel}
TOTAL DAYS WITH LOGS: ${logs.length}
DAYS ALL GOALS HIT: ${logs.filter(l => l.all_daily_hit === 'TRUE').length}

=== ACTIVE DAILY GOALS & COMPLETION RATES ===
${goalStats.join('\n') || '(none)'}

=== DAILY LOG DETAIL ===
${logLines.join('\n') || '(none)'}

=== COMPLETED ONE-OFF GOALS THIS PERIOD ===
${completedOneoffs.map(g => `  ${g.done_date}: ${g.text}`).join('\n') || '(none)'}

=== PENDING ONE-OFF GOALS (not yet done) ===
${pendingOneoffs.map(g => `  added ${g.created_date}: ${g.text}`).join('\n') || '(none)'}

=== JOB APPLICATIONS ===
Total: ${applications.length} | Waiting: ${waiting.length} | Rejected: ${rejected.length}
${applications.map(a => `  ${a.dateApplied}: ${a.company} — ${a.status}`).join('\n') || '(none)'}

=== CALENDAR EVENTS THIS PERIOD ===
${calendarEvents.length > 0 ? calendarEvents.map(e => `  ${e.date}: ${e.title} (${e.start}${e.allDay ? ', all day' : ` – ${e.end}`})`).join('\n') : '(none)'}
`.trim();

  console.log('[claude] Calling summarizeProgress (life coach)...');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: LIFE_COACH_PROMPT,
    messages: [{ role: 'user', content: context }],
  });

  return response.content[0]?.text ?? 'Could not generate summary.';
}

// ─── summarizeNews ────────────────────────────────────────────────────────────
// Takes an array of { title, description, url, source } objects and returns
// a WhatsApp-friendly digest string.

const NEWS_SYSTEM_PROMPT = `You are a concise news summarizer writing for WhatsApp.
Summarize the provided news articles into a morning digest.

Format requirements:
- Start with a greeting line: "Good morning! Here's your news digest ☀️"
- List 5–6 of the most important/interesting stories
- For each story: one bold-style header line (use *asterisks* for WhatsApp bold) followed by one sentence of context
- End with a short motivational sign-off line
- Total length: under 1200 characters (WhatsApp messages should be skimmable)
- No markdown beyond *bold* — no headers, bullets as dashes only`;

export async function summarizeNews(articles) {
  const articlesText = articles
    .slice(0, 15)
    .map((a, i) => `${i + 1}. ${a.title}\n   ${a.description ?? ''}`)
    .join('\n\n');

  console.log('[claude] Calling summarizeNews...');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: NEWS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: articlesText }],
  });

  return response.content[0]?.text ?? 'Could not generate news digest.';
}
