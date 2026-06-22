import Anthropic from '@anthropic-ai/sdk';

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
// Takes a period label, log rows, goal maps, and returns a WhatsApp-friendly summary.

const PROGRESS_SYSTEM_PROMPT = `You are a personal accountability coach reviewing someone's goal tracking data.
You will be given their daily logs and completed one-off goals over a time period.
Write a concise, encouraging progress summary formatted for Telegram.

Format:
- Start with the period and total days logged
- Highlight streaks and consistency patterns
- List which daily goals they hit most/least
- List one-off goals they completed
- End with one motivational sentence

Use *bold* for section labels. Keep it under 1000 characters. Be specific with numbers, not vague.`;

export async function summarizeProgress(periodLabel, logs, dailyGoals, completedOneoffs) {
  const goalMap = Object.fromEntries(dailyGoals.map(g => [g.id, g.text]));

  const logLines = logs.map(l => {
    const hitGoals = (l.completed_daily_goal_ids || '').split(',').filter(Boolean).map(id => goalMap[id] || id);
    return `${l.date}: hit=[${hitGoals.join(', ') || 'none'}] all_hit=${l.all_daily_hit} notes="${l.notes || ''}"`;
  });

  const oneoffLines = completedOneoffs.map(g => `${g.done_date}: ${g.text}`);

  const context = `Period: ${periodLabel}
Days logged: ${logs.length}

Daily logs:
${logLines.join('\n') || '(none)'}

Completed one-off goals:
${oneoffLines.join('\n') || '(none)'}`;

  console.log('[claude] Calling summarizeProgress...');

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: PROGRESS_SYSTEM_PROMPT,
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
