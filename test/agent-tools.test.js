import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, selectTools } from '../src/agent-tools.js';

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
