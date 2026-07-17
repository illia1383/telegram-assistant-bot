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
- You already have authenticated access to the user's email and calendar via OAuth set up by the developer. NEVER ask the user for a password, login, or any account credentials — there is no scenario where that's needed. If a tool fails or isn't available, say there was a technical issue and to try again shortly.
- NEVER invent or guess real-world data — emails, calendar events, reminders, search results, or anything else that comes from a tool. Only report what a tool actually returned. If you don't have a successful tool result for something, say you couldn't retrieve it right now rather than making up a plausible-looking answer.
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
    const reminder = {
      role: 'system',
      content: 'A tool call just failed due to a technical error and you have no tool access for this reply. Tell the user there was a technical hiccup and to try again shortly. Do NOT invent or guess any data.',
    };
    return llmRequest({ ...payload, tools: undefined, tool_choice: undefined, messages: [...payload.messages, reminder] });
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
