import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvFile } from '../scripts/env-template.js';

test('buildEnvFile: fills in provided values', () => {
  const out = buildEnvFile({ telegramBotToken: 'abc123', timezone: 'America/New_York' });
  assert.match(out, /^TELEGRAM_BOT_TOKEN=abc123$/m);
  assert.match(out, /^TIMEZONE=America\/New_York$/m);
});

test('buildEnvFile: missing values are written blank, not omitted', () => {
  const out = buildEnvFile({});
  assert.match(out, /^TELEGRAM_BOT_TOKEN=$/m);
  assert.match(out, /^GOOGLE_SHEET_ID=$/m);
});

test('buildEnvFile: keeps section comment lines', () => {
  const out = buildEnvFile({});
  assert.match(out, /# ─── Telegram/);
  assert.match(out, /# ─── Google/);
});

test('buildEnvFile: ends with a trailing newline', () => {
  const out = buildEnvFile({});
  assert.ok(out.endsWith('\n'));
  assert.ok(!out.endsWith('\n\n'));
});
