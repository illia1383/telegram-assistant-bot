import axios from 'axios';
import crypto from 'crypto';

const BASE_URL = 'https://graph.facebook.com/v19.0';

// ─── Send a text message ──────────────────────────────────────────────────────

export async function sendMessage(text) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const to = process.env.WHATSAPP_RECIPIENT_NUMBER;

  console.log(`[whatsapp] Sending message to ${to}: ${text.slice(0, 80)}...`);

  try {
    await axios.post(
      `${BASE_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      }
    );
    console.log('[whatsapp] Message sent successfully');
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[whatsapp] Failed to send message:', detail);
  }
}

// ─── Webhook verification (GET) ───────────────────────────────────────────────

export function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[whatsapp] Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.warn('[whatsapp] Webhook verification failed — token mismatch');
    res.sendStatus(403);
  }
}

// ─── Payload signature verification (optional) ────────────────────────────────

export function verifySignature(rawBody, signatureHeader) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return true; // Skip if not configured

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader || ''));
  } catch {
    return false;
  }
}

// ─── Extract message from webhook payload ─────────────────────────────────────

export function extractMessage(body) {
  try {
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message || message.type !== 'text') return null;
    return {
      from: message.from,
      text: message.text?.body ?? '',
      messageId: message.id,
    };
  } catch {
    return null;
  }
}

// ─── Sender guard ─────────────────────────────────────────────────────────────

export function isAuthorizedSender(from) {
  const allowed = process.env.WHATSAPP_RECIPIENT_NUMBER;
  return from === allowed;
}
