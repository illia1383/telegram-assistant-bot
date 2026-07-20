import { google } from 'googleapis';
import { getOAuthClient } from './google-auth.js';

// ─── Gmail email agent ─────────────────────────────────────────────────────────
// Requires the OAuth refresh token to include the gmail.modify scope.
// Re-run scripts/get-calendar-token.js (it now requests Calendar + Gmail).

function getGmail() {
  return google.gmail({ version: 'v1', auth: getOAuthClient() });
}

function header(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

// Caps email body length before it enters the agent's conversation history —
// that history gets resent on every subsequent turn, so an untruncated body
// compounds TPM cost fast. 2000 chars is plenty to summarize or draft a reply.
export function truncateBody(body, maxLength = 2000) {
  return body.length > maxLength ? body.slice(0, maxLength) + '\n...[truncated]' : body;
}

// Recursively find the text/plain (fallback text/html) body in a MIME tree
export function extractBody(payload) {
  if (!payload) return '';

  if (payload.body?.data && (payload.mimeType === 'text/plain' || payload.mimeType === 'text/html')) {
    const text = Buffer.from(payload.body.data, 'base64url').toString('utf8');
    return payload.mimeType === 'text/html'
      ? text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : text;
  }

  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractBody(plain);
    for (const part of payload.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }
  return '';
}

// ─── List / search emails ──────────────────────────────────────────────────────
// query uses standard Gmail search syntax, e.g. "is:unread", "from:amazon.com"

export async function listEmails({ query = 'in:inbox', maxResults = 10 } = {}) {
  const gmail = getGmail();
  const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  const messages = res.data.messages || [];

  const emails = await Promise.all(
    messages.map(async m => {
      const msg = await gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const headers = msg.data.payload?.headers;
      return {
        id: m.id,
        threadId: msg.data.threadId,
        from: header(headers, 'From'),
        subject: header(headers, 'Subject'),
        date: header(headers, 'Date'),
        snippet: msg.data.snippet ?? '',
        unread: (msg.data.labelIds || []).includes('UNREAD'),
      };
    })
  );

  return emails;
}

// ─── Read a full email ─────────────────────────────────────────────────────────

export async function readEmail(id) {
  const gmail = getGmail();
  const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const headers = res.data.payload?.headers;

  const body = extractBody(res.data.payload);
  return {
    id,
    threadId: res.data.threadId,
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date'),
    messageIdHeader: header(headers, 'Message-ID'),
    body: truncateBody(body),
  };
}

// ─── Compose (raw RFC 2822 → base64url) ───────────────────────────────────────

export function buildRawMessage({ to, subject, body, inReplyTo = null }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ];
  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
    lines.push(`References: ${inReplyTo}`);
  }
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

// Create a draft (safe default — user reviews in Gmail before it goes out)
export async function createDraft({ to, subject, body, replyToEmailId = null }) {
  const gmail = getGmail();

  let threadId = null;
  let inReplyTo = null;
  if (replyToEmailId) {
    const original = await readEmail(replyToEmailId);
    threadId = original.threadId;
    inReplyTo = original.messageIdHeader;
    if (!subject) subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;
    if (!to) to = original.from;
  }

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: buildRawMessage({ to, subject, body, inReplyTo }),
        ...(threadId ? { threadId } : {}),
      },
    },
  });
  console.log(`[gmail] Draft created: "${subject}" → ${to}`);
  return { draftId: res.data.id, to, subject };
}

// Send immediately (agent asks for confirmation before using this)
export async function sendEmail({ to, subject, body, replyToEmailId = null }) {
  const gmail = getGmail();

  let threadId = null;
  let inReplyTo = null;
  if (replyToEmailId) {
    const original = await readEmail(replyToEmailId);
    threadId = original.threadId;
    inReplyTo = original.messageIdHeader;
    if (!subject) subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;
    if (!to) to = original.from;
  }

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: buildRawMessage({ to, subject, body, inReplyTo }),
      ...(threadId ? { threadId } : {}),
    },
  });
  console.log(`[gmail] Sent: "${subject}" → ${to}`);
  return { messageId: res.data.id, to, subject };
}

// ─── Inbox actions ─────────────────────────────────────────────────────────────

export async function archiveEmail(id) {
  const gmail = getGmail();
  await gmail.users.messages.modify({
    userId: 'me',
    id,
    requestBody: { removeLabelIds: ['INBOX'] },
  });
  console.log(`[gmail] Archived message id=${id}`);
  return true;
}

export async function markRead(id) {
  const gmail = getGmail();
  await gmail.users.messages.modify({
    userId: 'me',
    id,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
  return true;
}

// ─── Triage summary for the daily briefing ─────────────────────────────────────

export async function getUnreadSummaryData(maxResults = 15) {
  return listEmails({ query: 'is:unread in:inbox', maxResults });
}
