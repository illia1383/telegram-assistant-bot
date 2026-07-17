import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBody, buildRawMessage } from '../src/gmail.js';

const b64 = s => Buffer.from(s, 'utf8').toString('base64url');

test('extractBody: plain text body', () => {
  const payload = { mimeType: 'text/plain', body: { data: b64('hello world') } };
  assert.equal(extractBody(payload), 'hello world');
});

test('extractBody: html body is stripped to text', () => {
  const payload = {
    mimeType: 'text/html',
    body: { data: b64('<style>p{color:red}</style><p>Hi <b>there</b></p>') },
  };
  assert.equal(extractBody(payload), 'Hi there');
});

test('extractBody: multipart prefers text/plain over html', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/html', body: { data: b64('<p>html version</p>') } },
      { mimeType: 'text/plain', body: { data: b64('plain version') } },
    ],
  };
  assert.equal(extractBody(payload), 'plain version');
});

test('extractBody: nested multipart recurses', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [{
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/plain', body: { data: b64('nested') } }],
    }],
  };
  assert.equal(extractBody(payload), 'nested');
});

test('extractBody: empty/missing payload → empty string', () => {
  assert.equal(extractBody(null), '');
  assert.equal(extractBody({ mimeType: 'image/png', body: {} }), '');
});

test('buildRawMessage: encodes headers and body', () => {
  const raw = buildRawMessage({ to: 'a@b.com', subject: 'Hi', body: 'Test body' });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /^To: a@b\.com\r\n/);
  assert.match(decoded, /Subject: Hi\r\n/);
  assert.match(decoded, /\r\n\r\nTest body$/);
});

test('buildRawMessage: reply sets In-Reply-To and References', () => {
  const raw = buildRawMessage({ to: 'a@b.com', subject: 'Re: Hi', body: 'x', inReplyTo: '<msg123@mail>' });
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(decoded, /In-Reply-To: <msg123@mail>\r\n/);
  assert.match(decoded, /References: <msg123@mail>\r\n/);
});
