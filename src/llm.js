import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIFE_COACH_PROMPT = readFileSync(join(__dirname, '../prompts/life-coach.md'), 'utf8');

// Any OpenAI-compatible endpoint works: Groq, OpenRouter, Together, local Ollama, vLLM.
export async function llmRequest(payload) {
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.LLM_API_KEY || 'none'}`,
    },
    body: JSON.stringify({
      ...payload,
      model: payload.model || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
    }),
  });

  if (!res.ok) throw new Error(`LLM API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function chat(system, user, maxTokens) {
  const data = await llmRequest({
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return data.choices?.[0]?.message?.content ?? '';
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

// Open models often wrap JSON in fences or prose — extract the outermost object.
export function extractCheckinJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (
      !Array.isArray(parsed.completed_daily_goal_ids) ||
      !Array.isArray(parsed.completed_oneoff_ids)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function parseCheckinMessage(message, dailyGoals, oneoffGoals) {
  const goalsContext = `
ACTIVE DAILY GOALS:
${dailyGoals.map(g => `  id="${g.id}" → ${g.text}`).join('\n') || '  (none)'}

PENDING ONE-OFF GOALS:
${oneoffGoals.map(g => `  id="${g.id}" → ${g.text}`).join('\n') || '  (none)'}

USER MESSAGE:
${message}`;

  console.log('[llm] Calling parseCheckinMessage...');
  const raw = await chat(CHECKIN_SYSTEM_PROMPT, goalsContext, 512);

  const parsed = extractCheckinJson(raw);
  if (!parsed) console.error('[llm] Failed to parse check-in JSON response');
  return parsed;
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

  console.log('[llm] Calling summarizeProgress (life coach)...');
  const text = await chat(LIFE_COACH_PROMPT, context, 1500);
  return text || 'Could not generate summary.';
}

// ─── summarizeNews ────────────────────────────────────────────────────────────
// Takes an array of { title, description, url, source } objects and returns
// a Telegram-friendly digest string.

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

  console.log('[llm] Calling summarizeNews...');
  const text = await chat(NEWS_SYSTEM_PROMPT, articlesText, 600);
  return text || 'Could not generate news digest.';
}

// ─── summarizeInbox ───────────────────────────────────────────────────────────
// Takes an array of { from, subject, snippet } and returns a short triage digest.

const INBOX_SYSTEM_PROMPT = `You are an email triage assistant writing for Telegram.
Summarize the unread emails into a short morning triage.

Format requirements:
- Start with: "📧 *Inbox* — N unread" (N = the count given)
- Group by importance: anything urgent/actionable first, then FYI, skip obvious spam/promos entirely
- One line per email: *Sender* — what they want, in a few words
- If nothing needs attention, say so in one line
- Total length: under 900 characters
- Only *asterisk* bold, no other markdown`;

export async function summarizeInbox(emails) {
  if (!emails || emails.length === 0) return '📧 *Inbox* — no unread emails. Clean slate!';

  const emailsText = emails
    .map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   ${e.snippet}`)
    .join('\n\n');

  console.log('[llm] Calling summarizeInbox...');
  const text = await chat(INBOX_SYSTEM_PROMPT, `UNREAD COUNT: ${emails.length}\n\n${emailsText}`, 500);
  return text || 'Could not summarize inbox.';
}
