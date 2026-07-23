import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, selectTools, asNumber, resolveGoalIds } from '../src/agent-tools.js';

const names = (tools) => tools.map(t => t.function.name);

test('plain messages only get the core goal/search tools', () => {
  const tools = selectTools('did 3 leetcodes today');
  assert.ok(names(tools).includes('log_accomplishments'));
  assert.ok(names(tools).includes('web_search'));
  assert.ok(!names(tools).includes('list_emails'));
  assert.ok(!names(tools).includes('create_calendar_event'));
  assert.ok(tools.length < TOOLS.length);
});

test('calendar keywords pull in calendar tools only', () => {
  const tools = selectTools('what is on my calendar tomorrow?');
  assert.ok(names(tools).includes('get_calendar_events'));
  assert.ok(!names(tools).includes('list_emails'));
  assert.ok(!names(tools).includes('add_reminder'));
});

test('email keywords pull in email tools only', () => {
  const tools = selectTools('summarize my unread emails');
  assert.ok(names(tools).includes('list_emails'));
  assert.ok(!names(tools).includes('get_calendar_events'));
});

test('reminder keywords pull in reminder tools', () => {
  const tools = selectTools('remind me at 5pm to call mom');
  assert.ok(names(tools).includes('add_reminder'));
});

test('multiple matching categories are all included', () => {
  const tools = selectTools('email me a reminder about the meeting tomorrow');
  assert.ok(names(tools).includes('list_emails'));
  assert.ok(names(tools).includes('add_reminder'));
  assert.ok(names(tools).includes('get_calendar_events'));
});

test('core tools are always present regardless of category matches', () => {
  const tools = selectTools('draft a reply to the recruiter');
  assert.ok(names(tools).includes('get_streaks'));
  assert.ok(names(tools).includes('get_today_status'));
});

test('selected tool count is meaningfully smaller than the full set', () => {
  // Guards against the token-budget fix silently regressing back to sending everything.
  assert.ok(selectTools('did 3 leetcodes').length <= TOOLS.length / 2);
});

test('asNumber coerces stringified numbers (Llama 4 Scout sends "10" for max_results)', () => {
  assert.equal(asNumber('10', 5), 10);
  assert.equal(asNumber(10, 5), 10);
});

test('asNumber falls back on missing or invalid input', () => {
  assert.equal(asNumber(undefined, 30), 30);
  assert.equal(asNumber('not a number', 30), 30);
});

test('numeric tool params accept both number and string types (Groq schema)', () => {
  const byName = Object.fromEntries(TOOLS.map(t => [t.function.name, t.function.parameters.properties]));
  assert.deepEqual(byName.list_emails.max_results.type, ['number', 'string']);
  assert.deepEqual(byName.find_free_slots.duration_minutes.type, ['number', 'string']);
});

// Regression coverage for goal check-offs that silently never took: the agent
// is supposed to call get_today_status before log_accomplishments to get real
// ids, but nothing enforces that, and a garbled/guessed id used to merge into
// the log without ever matching a real goal — leaving it stuck unchecked.
const GOALS = [
  { id: 'abc-123', text: '3 leetcodes' },
  { id: 'def-456', text: 'apply' },
];

test('resolveGoalIds matches a real id directly', () => {
  assert.deepEqual(resolveGoalIds(['abc-123'], GOALS), ['abc-123']);
});

test('resolveGoalIds falls back to exact goal text (case-insensitive)', () => {
  assert.deepEqual(resolveGoalIds(['Apply'], GOALS), ['def-456']);
});

test('resolveGoalIds falls back to a substring match either direction', () => {
  assert.deepEqual(resolveGoalIds(['leetcodes'], GOALS), ['abc-123']);
});

test('resolveGoalIds drops identifiers matching no real goal instead of passing them through', () => {
  assert.deepEqual(resolveGoalIds(['made up nonsense'], GOALS), []);
});

test('resolveGoalIds dedupes when id and text both resolve to the same goal', () => {
  assert.deepEqual(resolveGoalIds(['def-456', 'apply'], GOALS), ['def-456']);
});
