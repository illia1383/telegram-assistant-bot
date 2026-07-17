import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, resetConversation } from '../src/agent.js';

// getMemoryContext hits Google Sheets — point it at nothing so it fails fast
// and the agent still runs (memory is injected best-effort).
const realFetch = globalThis.fetch;
beforeEach(() => resetConversation());
afterEach(() => { globalThis.fetch = realFetch; });

// Queue of responses the fake LLM returns, one per request; captures each request body.
function stubLlm(replies) {
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push({ url, body: JSON.parse(opts.body) });
    const message = replies.shift() ?? { role: 'assistant', content: 'done' };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  };
  return requests;
}

const text = (content) => ({ role: 'assistant', content });
const toolCall = (id, name, args) => ({
  role: 'assistant',
  content: null,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
});

test('plain text reply comes straight back', async () => {
  const requests = stubLlm([text('Hey! All goals on track 💪')]);
  const reply = await runAgent('how am i doing?');

  assert.equal(reply, 'Hey! All goals on track 💪');
  assert.equal(requests.length, 1);

  const { body } = requests[0];
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.at(-1).content, 'how am i doing?');
  assert.ok(Array.isArray(body.tools) && body.tools.length > 0);
});

test('system prompt forbids ever asking the user for credentials', async () => {
  const requests = stubLlm([text('ok')]);
  await runAgent('summarize my unread emails');

  assert.match(requests[0].body.messages[0].content, /NEVER ask the user for a password/i);
});

test('system prompt forbids fabricating tool data', async () => {
  const requests = stubLlm([text('ok')]);
  await runAgent('summarize my unread emails');

  assert.match(requests[0].body.messages[0].content, /NEVER invent or guess real-world data/i);
});

test('tool_use_failed retry injects an explicit no-fabrication reminder', async () => {
  const requests = [];
  let call = 0;
  globalThis.fetch = async (url, opts) => {
    call++;
    const body = JSON.parse(opts.body);
    requests.push(body);
    if (call === 1) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: { message: 'tool call validation failed: bad schema', code: 'tool_use_failed' },
        }),
      };
    }
    return { ok: true, json: async () => ({ choices: [{ message: text('Sorry, technical hiccup — try again shortly.') }] }) };
  };

  const reply = await runAgent('summarize my unread emails');

  assert.match(reply, /technical hiccup/);
  assert.equal(call, 2);
  const retryMessages = requests[1].messages;
  assert.match(retryMessages.at(-1).content, /Do NOT invent or guess any data/i);
});

test('tools are sent in OpenAI function format', async () => {
  const requests = stubLlm([text('ok')]);
  await runAgent('hi');

  for (const tool of requests[0].body.tools) {
    assert.equal(tool.type, 'function');
    assert.equal(typeof tool.function.name, 'string');
    assert.equal(tool.function.parameters.type, 'object');
  }
});

test('unknown tool call feeds an error result back and continues the loop', async () => {
  const requests = stubLlm([
    toolCall('call_1', 'nonexistent_tool', {}),
    text('Sorry, that failed.'),
  ]);
  const reply = await runAgent('do something');

  assert.equal(reply, 'Sorry, that failed.');
  assert.equal(requests.length, 2);

  const toolMsg = requests[1].body.messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.equal(toolMsg.tool_call_id, 'call_1');
  assert.match(toolMsg.content, /Unknown tool: nonexistent_tool/);
});

test('conversation history persists across runs (non-isolated)', async () => {
  stubLlm([text('first')]);
  await runAgent('message one');

  const requests = stubLlm([text('second')]);
  await runAgent('message two');

  const contents = requests[0].body.messages.map(m => m.content);
  assert.ok(contents.includes('message one'));
  assert.ok(contents.includes('first'));
  assert.ok(contents.includes('message two'));
});

test('isolated runs do not touch history', async () => {
  stubLlm([text('automation result')]);
  await runAgent('automation prompt', { isolated: true });

  const requests = stubLlm([text('reply')]);
  await runAgent('normal message');

  const contents = requests[0].body.messages.map(m => m.content);
  assert.ok(!contents.includes('automation prompt'));
});

test('LLM request failure returns a friendly message instead of throwing', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });

  const reply = await runAgent('what is the latest on crypto');
  assert.match(reply, /error talking to the AI model/);
});

test('tool_use_failed triggers one retry without tools, not a crash', async () => {
  const requests = [];
  let call = 0;
  globalThis.fetch = async (url, opts) => {
    call++;
    const body = JSON.parse(opts.body);
    requests.push(body);
    if (call === 1) {
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: {
            message: "tool call validation failed: attempted to call tool 'web_search{\"query\": \"latest crypto news\"}' which was not in request.tools",
            code: 'tool_use_failed',
          },
        }),
      };
    }
    return okFor(body);
  };

  function okFor() {
    return { ok: true, json: async () => ({ choices: [{ message: text('Bitcoin is up today.') }] }) };
  }

  const reply = await runAgent('what is the latest on crypto');

  assert.equal(reply, 'Bitcoin is up today.');
  assert.equal(call, 2);
  assert.ok(requests[0].tools?.length > 0);
  assert.equal(requests[1].tools, undefined);
  assert.equal(requests[1].tool_choice, undefined);
});

test('a second tool_use_failed after the retry still falls back gracefully', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: 'tool call validation failed', code: 'tool_use_failed' } }),
  });

  const reply = await runAgent('what is the latest on crypto');
  assert.match(reply, /error talking to the AI model/);
});

test('LLM failure on a later turn (after a tool call) still returns gracefully', async () => {
  let call = 0;
  globalThis.fetch = async (url, opts) => {
    call++;
    if (call === 1) {
      const message = toolCall('call_1', 'web_search', { query: 'crypto' });
      return { ok: true, json: async () => ({ choices: [{ message }] }) };
    }
    return { ok: false, status: 500, text: async () => 'server error' };
  };

  const reply = await runAgent('what is the latest on crypto');
  assert.match(reply, /error talking to the AI model/);
  assert.equal(call, 2);
});

test('malformed tool arguments become an error result, not a crash', async () => {
  const requests = stubLlm([
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_bad', type: 'function', function: { name: 'get_streaks', arguments: '{not json' } }],
    },
    text('recovered'),
  ]);
  const reply = await runAgent('streaks?');

  assert.equal(reply, 'recovered');
  const toolMsg = requests[1].body.messages.at(-1);
  assert.equal(toolMsg.role, 'tool');
  assert.match(toolMsg.content, /error/);
});
