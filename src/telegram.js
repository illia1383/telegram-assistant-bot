import TelegramBot from 'node-telegram-bot-api';

let bot = null;

export function getBot() {
  if (!bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    // polling: true means the bot long-polls Telegram — no webhook or ngrok needed
    bot = new TelegramBot(token, { polling: true });
  }
  return bot;
}

// ─── Send a message to the configured recipient ───────────────────────────────

export async function sendMessage(text) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.error('[telegram] TELEGRAM_CHAT_ID is not set — cannot send message');
    return;
  }
  try {
    await getBot().sendMessage(chatId, text, { parse_mode: 'Markdown' });
    console.log(`[telegram] Sent message to chat ${chatId}: ${text.slice(0, 80)}...`);
  } catch (err) {
    // Retry without Markdown if parsing fails (e.g. unescaped special chars)
    try {
      await getBot().sendMessage(chatId, text);
    } catch (retryErr) {
      console.error('[telegram] Failed to send message:', retryErr.message);
    }
  }
}

// ─── Authorize only your own chat ─────────────────────────────────────────────

export function isAuthorizedSender(chatId) {
  return String(chatId) === String(process.env.TELEGRAM_CHAT_ID);
}

// ─── Wire up the message handler ─────────────────────────────────────────────
// Pass in the async handler function from server.js.

export function initBot(onMessage) {
  const b = getBot();

  b.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text ?? '';

    if (!isAuthorizedSender(chatId)) {
      // Log the chat ID so the user can paste it into .env if needed
      console.log(`[telegram] Message from unauthorized chat_id=${chatId} — ignoring`);
      console.log(`[telegram] If this is you, set TELEGRAM_CHAT_ID=${chatId} in your .env`);
      return;
    }

    console.log(`[telegram] Received message from chat ${chatId}: "${text}"`);

    try {
      await onMessage(text);
    } catch (err) {
      console.error('[telegram] Error handling message:', err);
      await sendMessage('Something went wrong on my end. Check the server logs.');
    }
  });

  b.on('polling_error', (err) => {
    console.error('[telegram] Polling error:', err.message);
  });

  console.log('[telegram] Bot started — polling for messages');
}
