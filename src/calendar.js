import { google } from 'googleapis';
import { getOAuthClient } from './google-auth.js';

function getClient() {
  return google.calendar({ version: 'v3', auth: getOAuthClient() });
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
    id: e.id,
    title: e.summary ?? '(No title)',
    start: formatTime(e.start?.dateTime, e.start?.date, tz),
    end: formatTime(e.end?.dateTime, e.end?.date, tz),
    allDay: !e.start?.dateTime,
    location: e.location ?? null,
  }));
}

// ─── Get events over a date range (inclusive) ─────────────────────────────────

export async function getEventsForRange(startDate, endDate) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const client = getClient();

  const res = await client.events.list({
    calendarId: 'primary',
    timeMin: new Date(`${startDate}T00:00:00`).toISOString(),
    timeMax: new Date(`${endDate}T23:59:59`).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    timeZone: tz,
  });

  return (res.data.items || []).map(e => ({
    id: e.id,
    title: e.summary ?? '(No title)',
    date: e.start?.dateTime ? e.start.dateTime.slice(0, 10) : e.start?.date,
    start: formatTime(e.start?.dateTime, e.start?.date, tz),
    end: formatTime(e.end?.dateTime, e.end?.date, tz),
    startIso: e.start?.dateTime ?? null,
    endIso: e.end?.dateTime ?? null,
    allDay: !e.start?.dateTime,
    location: e.location ?? null,
  }));
}

// ─── Create a calendar event ──────────────────────────────────────────────────
// Expects: { title, date, startTime, endTime } where times are "HH:MM" (24h) strings

export async function createEvent({ title, date, startTime, endTime, location, description }) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const client = getClient();

  const res = await client.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      ...(location ? { location } : {}),
      ...(description ? { description } : {}),
      start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
      end:   { dateTime: `${date}T${endTime}:00`,   timeZone: tz },
    },
  });

  return res.data;
}

// ─── Update (reschedule / rename) an event ─────────────────────────────────────

export async function updateEvent(eventId, { title, date, startTime, endTime, location, description }) {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const client = getClient();

  const patch = {};
  if (title) patch.summary = title;
  if (location !== undefined) patch.location = location;
  if (description !== undefined) patch.description = description;
  if (date && startTime) patch.start = { dateTime: `${date}T${startTime}:00`, timeZone: tz };
  if (date && endTime) patch.end = { dateTime: `${date}T${endTime}:00`, timeZone: tz };

  const res = await client.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: patch,
  });
  console.log(`[calendar] Updated event ${eventId}`);
  return res.data;
}

// ─── Delete an event ────────────────────────────────────────────────────────────

export async function deleteEvent(eventId) {
  const client = getClient();
  await client.events.delete({ calendarId: 'primary', eventId });
  console.log(`[calendar] Deleted event ${eventId}`);
  return true;
}

// ─── Find free slots on a given day ─────────────────────────────────────────────
// Returns open windows of at least durationMinutes between earliest and latest ("HH:MM" 24h).

export function computeFreeSlots(busy, dayStart, dayEnd, durationMinutes) {
  const sorted = busy
    .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
    .sort((a, b) => a.start - b.start);

  const slots = [];
  let cursor = dayStart;
  for (const b of sorted) {
    if (b.start - cursor >= durationMinutes * 60_000) {
      slots.push({ start: new Date(cursor), end: new Date(b.start) });
    }
    if (b.end > cursor) cursor = b.end;
  }
  if (dayEnd - cursor >= durationMinutes * 60_000) {
    slots.push({ start: new Date(cursor), end: dayEnd });
  }
  return slots;
}

export async function findFreeSlots(date, durationMinutes = 30, earliest = '09:00', latest = '18:00') {
  const tz = process.env.TIMEZONE || 'America/New_York';
  const client = getClient();

  const dayStart = new Date(`${date}T${earliest}:00`);
  const dayEnd = new Date(`${date}T${latest}:00`);

  const res = await client.freebusy.query({
    requestBody: {
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      timeZone: tz,
      items: [{ id: 'primary' }],
    },
  });

  const slots = computeFreeSlots(res.data.calendars?.primary?.busy || [], dayStart, dayEnd, durationMinutes);
  const fmt = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
  return slots.map(s => ({ start: fmt(s.start), end: fmt(s.end) }));
}

// ─── Format events for Telegram ───────────────────────────────────────────────

export function formatEventsMessage(events, label) {
  if (events.length === 0) return `📅 *${label}*\nNo events scheduled.`;
  const lines = events.map(e =>
    e.allDay ? `• ${e.title} *(all day)*` : `• ${e.start} – ${e.end}: ${e.title}`
  );
  return `📅 *${label}*\n${lines.join('\n')}`;
}
