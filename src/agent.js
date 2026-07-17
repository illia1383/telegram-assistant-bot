import { llmRequest } from './llm.js';
import { getMemoryContext } from './memory.js';
import { EXECUTORS, selectTools } from './agent-tools.js';

const MAX_AGENT_TURNS = 10;
const MAX_HISTORY_MESSAGES = 24;

let history = [];

export function resetConversation() {
  history = [];
}

function buildSystemPrompt(memoryContext) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const dateStr = new Date().toLocaleString('en-US', {
    timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });

  return `You are the user's personal AI assistant on Telegram — their chief of staff. You manage their email, calendar, goals, reminders, automations, job applications, and can research the web.

CURRENT DATE & TIME: ${dateStr} (timezone: ${tz})

RULES:
- Use tools to take real actions. Chain tools when needed (get_today_status before log_accomplishments; get_calendar_events before update/delete).
- NEVER send an email without the user explicitly confirming the exact content. Default to draft_email and show the draft text in your reply.
- Confirm before deleting calendar events or forgetting memories, unless the user explicitly asked.
- When the user shares a lasting preference, correction, or personal fact, save it with remember — no need to ask.
- When the user describes things they accomplished today, log them against their goals.
- Reminders: compute due_iso from the current date/time above; never schedule in the past.
- Automations: propose a cron schedule and confirm before creating.

STYLE:
- You're texting on Telegram. Be concise and useful. Use *asterisks* for bold, emoji sparingly.
- Keep replies short unless the user asked for detail.
- Never mention tool names or JSON — describe actions naturally.${memoryContext}`;
}

// Trim to a clean boundary: never leave a leading orphaned tool result.
export function trimHistory(msgs, max = MAX_HISTORY_MESSAGES) {
  if (msgs.length <= max) return msgs;
  let cut = msgs.length - max;
  while (cut < msgs.length && msgs[cut]?.role === 'tool') cut++;
  return msgs.slice(cut);
}

// Llama 3.3 occasionally emits a malformed tool call (e.g. concatenating the
// arguments onto the tool name) that Groq rejects with tool_use_failed before
// it reaches us. Retry once without tools so the model answers in plain text.
async function requestWithToolFallback(payload) {
  try {
    return await llmRequest(payload);
  } catch (err) {
    if (!err.message.includes('tool_use_failed')) throw err;
    console.error('[agent] Tool call generation failed, retrying without tools:', err.message);
    return llmRequest({ ...payload, tools: undefined, tool_choice: undefined });
  }
}

export async function runAgent(userMessage, { isolated = false } = {}) {
  const system = buildSystemPrompt(await getMemoryContext());

  const messages = isolated ? [] : history;
  messages.push({ role: 'user', content: userMessage });

  const tools = selectTools(userMessage);
  let finalText = '';

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    let data;
    try {
      data = await requestWithToolFallback({
        max_tokens: 2000,
        messages: [{ role: 'system', content: system }, ...messages],
        tools,
        tool_choice: 'auto',
      });
    } catch (err) {
      console.error('[agent] LLM request failed:', err.message);
      finalText = 'I hit an error talking to the AI model — try again in a moment.';
      break;
    }

    const msg = data.choices?.[0]?.message;
    if (!msg) break;
    messages.push(msg);

    if (msg.content) finalText = msg.content;
    if (!msg.tool_calls?.length) break;

    for (const tc of msg.tool_calls) {
      console.log(`[agent] Tool call: ${tc.function?.name}`);
      let result;
      try {
        const executor = EXECUTORS[tc.function?.name];
        if (!executor) throw new Error(`Unknown tool: ${tc.function?.name}`);
        result = await executor(JSON.parse(tc.function.arguments || '{}'));
      } catch (err) {
        console.error(`[agent] Tool ${tc.function?.name} failed:`, err.message);
        result = { error: err.message };
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  if (!isolated) history = trimHistory(messages);

  return finalText || 'Done! Anything else?';
}
