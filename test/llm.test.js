import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractCheckinJson, parseCheckinMessage, summarizeNews, summarizeInbox } from '../src/llm.js';

const VALID = { completed_daily_goal_ids: ['d1'], completed_oneoff_ids: [], notes: 'ran 5k' };

test('extractCheckinJson: plain JSON', () => {
  assert.deepEqual(extractCheckinJson(JSON.stringify(VALID)), VALID);
});

test('extractCheckinJson: markdown-fenced JSON', () => {
  assert.deepEqual(extractCheckinJson('```json\n' + JSON.stringify(VALID) + '\n```'), VALID);
});

test('extractCheckinJson: JSON wrapped in prose', () => {
  const raw = `Sure! Here is the result:\n${JSON.stringify(VALID)}\nLet me know if you need anything else.`;
  assert.deepEqual(extractCheckinJson(raw), VALID);
});

test('extractCheckinJson: invalid JSON → null', () => {
  assert.equal(extractCheckinJson('not json at all'), null);
  assert.equal(extractCheckinJson('{broken'), null);
});

test('extractCheckinJson: schema mismatch → null', () => {
  assert.equal(extractCheckinJson('{"completed_daily_goal_ids": "not-an-array", "completed_oneoff_ids": []}'), null);
});

// ─── chat client (stubbed fetch, no network) ─────────────────────────────────

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(url, JSON.parse(opts.body));
}

const okResponse = (content) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
});

test('parseCheckinMessage sends goals context and parses the reply', async () => {
  let captured;
  stubFetch((url, body) => {
    captured = { url, body };
    return okResponse(JSON.stringify(VALID));
  });

  const result = await parseCheckinMessage(
    'I went for a run',
    [{ id: 'd1', text: 'Run 5k' }],
    []
  );

  assert.deepEqual(result, VALID);
  assert.ok(captured.url.endsWith('/chat/completions'));
  assert.equal(captured.body.messages[0].role, 'system');
  assert.match(captured.body.messages[1].content, /id="d1" → Run 5k/);
  assert.match(captured.body.messages[1].content, /I went for a run/);
});

test('parseCheckinMessage returns null on garbage model output', async () => {
  stubFetch(() => okResponse('I could not determine any goals.'));
  assert.equal(await parseCheckinMessage('hi', [], []), null);
});

test('API error surfaces as a thrown error', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  await assert.rejects(() => summarizeNews([{ title: 't' }]), /LLM API error 429/);
});

test('summarizeInbox: empty inbox short-circuits without an API call', async () => {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  assert.match(await summarizeInbox([]), /no unread emails/);
});

test('summarizeInbox sends sender, subject, snippet and unread count', async () => {
  let captured;
  stubFetch((url, body) => {
    captured = body;
    return okResponse('📧 *Inbox* — 1 unread');
  });

  const reply = await summarizeInbox([{ from: 'Ana', subject: 'Interview', snippet: 'Are you free Friday?' }]);
  assert.equal(reply, '📧 *Inbox* — 1 unread');
  assert.match(captured.messages[1].content, /UNREAD COUNT: 1/);
  assert.match(captured.messages[1].content, /From: Ana/);
  assert.match(captured.messages[1].content, /Subject: Interview/);
});

test('respects LLM_BASE_URL and LLM_MODEL env overrides', async () => {
  process.env.LLM_BASE_URL = 'http://localhost:11434/v1/';
  process.env.LLM_MODEL = 'llama3.2';
  let captured;
  stubFetch((url, body) => {
    captured = { url, body };
    return okResponse('digest');
  });

  await summarizeNews([{ title: 't' }]);
  assert.equal(captured.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(captured.body.model, 'llama3.2');

  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
});
