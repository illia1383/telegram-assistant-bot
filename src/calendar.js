import { google } from 'googleapis';

function getClient() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  oAuth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
  });
  return google.calendar({ version: 'v3', auth: oAuth2Client });
}

function formatTime(dateTimeStr, dateStr, tz) {
  if (dateStr && !dateTimeStr) return 'All day';
  const d = new Date(dateTimeStr);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: tz,
  });
}

// ─── Get events for a specific day ───────────────────────────────────────────

export async function getEventsForDate(date) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);

  const client = getClient();
  const res = await client.events.list({
    calendarId: 'primary',
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: tz,
  });

  return (res.data.items || []).map(e => ({
    title: e.summary ?? '(No title)',
    start: formatTime(e.start?.dateTime, e.start?.date, tz),
    end: formatTime(e.end?.dateTime, e.end?.date, tz),
    allDay: !e.start?.dateTime,
    location: e.location ?? null,
  }));
}

// ─── Create a calendar event ──────────────────────────────────────────────────
// Expects: { title, date, startTime, endTime } where times are "HH:MM" (24h) strings

export async function createEvent({ title, date, startTime, endTime }) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const client = getClient();

  const res = await client.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
      end:   { dateTime: `${date}T${endTime}:00`,   timeZone: tz },
    },
  });

  return res.data;
}

// ─── Format events for Telegram ───────────────────────────────────────────────

export function formatEventsMessage(events, label) {
  if (events.length === 0) return `📅 *${label}*\nNo events scheduled.`;
  const lines = events.map(e =>
    e.allDay ? `• ${e.title} *(all day)*` : `• ${e.start} – ${e.end}: ${e.title}`
  );
  return `📅 *${label}*\n${lines.join('\n')}`;
}
