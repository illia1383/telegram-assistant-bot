import { randomUUID } from 'crypto';
import { getSheetData, appendRow, updateRow, rowsToObjects } from './sheets.js';
import { sendMessage } from './telegram.js';

const TAB = 'Reminders';

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ─── One-off reminders ("remind me at 5pm to call mom") ───────────────────────
// due_iso is a full ISO datetime string (with offset) computed by the agent.
// status: pending | sent | cancelled

export async function addReminder(text, dueIso) {
  const due = new Date(dueIso);
  if (isNaN(due.getTime())) throw new Error(`Invalid due datetime: ${dueIso}`);

  const id = randomUUID().slice(0, 8);
  await appendRow(TAB, [id, text, due.toISOString(), 'pending', todayString()]);
  console.log(`[reminders] Added: "${text}" due ${due.toISOString()} (id=${id})`);
  return { id, text, due_iso: due.toISOString() };
}

export async function getReminders(pendingOnly = true) {
  const rows = await getSheetData(TAB);
  const reminders = rowsToObjects(rows).filter(r => r.id);
  return pendingOnly ? reminders.filter(r => r.status === 'pending') : reminders;
}

async function setStatus(id, status) {
  const rows = await getSheetData(TAB);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const idCol = headers.indexOf('id');
  const rowIndex = rows.slice(1).findIndex(r => r[idCol] === id);
  if (rowIndex === -1) return false;

  const existing = Object.fromEntries(headers.map((h, i) => [h, rows[rowIndex + 1][i] ?? '']));
  await updateRow(TAB, rowIndex + 2, [existing.id, existing.text, existing.due_iso, status, existing.created_date]);
  return true;
}

export async function cancelReminder(id) {
  const ok = await setStatus(id, 'cancelled');
  if (ok) console.log(`[reminders] Cancelled id=${id}`);
  return ok;
}

// ─── Sweeper: fires due reminders once a minute ────────────────────────────────

export async function sweepReminders() {
  let due;
  try {
    const pending = await getReminders(true);
    const now = Date.now();
    due = pending.filter(r => new Date(r.due_iso).getTime() <= now);
  } catch (err) {
    console.error('[reminders] Sweep failed:', err.message);
    return;
  }

  for (const r of due) {
    try {
      await sendMessage(`⏰ *Reminder*\n\n${r.text}`);
      await setStatus(r.id, 'sent');
      console.log(`[reminders] Fired reminder id=${r.id}`);
    } catch (err) {
      console.error(`[reminders] Failed to fire reminder id=${r.id}:`, err.message);
    }
  }
}
