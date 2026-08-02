import { google } from 'googleapis';
import { randomUUID } from 'crypto';
import { getOAuthClient } from './google-auth.js';

function sheetId() {
  return process.env.GOOGLE_SHEET_ID;
}

export const TABS = {
  DAILY_GOALS: 'DailyGoals',
  ONEOFF_GOALS: 'OneoffGoals',
  DAILY_LOG: 'DailyLog',
  NEWS_LOG: 'NewsLog',
  MEMORY: 'Memory',
  REMINDERS: 'Reminders',
  AUTOMATIONS: 'Automations',
  JOB_APPLICATIONS: 'JobApplications',
};

const HEADERS = {
  [TABS.DAILY_GOALS]: ['id', 'text', 'created_date', 'active'],
  [TABS.ONEOFF_GOALS]: ['id', 'text', 'done', 'created_date', 'done_date'],
  [TABS.DAILY_LOG]: ['date', 'completed_daily_goal_ids', 'completed_oneoff_ids', 'notes', 'all_daily_hit'],
  [TABS.NEWS_LOG]: ['date', 'summary_sent'],
  [TABS.MEMORY]: ['id', 'fact', 'category', 'created_date'],
  [TABS.REMINDERS]: ['id', 'text', 'due_iso', 'status', 'created_date'],
  [TABS.AUTOMATIONS]: ['id', 'description', 'cron', 'prompt', 'active', 'created_date'],
  [TABS.JOB_APPLICATIONS]: ['company', 'dateApplied', 'status'],
};

let sheetsClient = null;

function getClient() {
  if (sheetsClient) return sheetsClient;
  sheetsClient = google.sheets({ version: 'v4', auth: getOAuthClient() });
  return sheetsClient;
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

export async function getSheetData(tabName) {
  const client = getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: sheetId(),
    range: `${tabName}!A:Z`,
  });
  return res.data.values || [];
}

export async function appendRow(tabName, row) {
  const client = getClient();
  await client.spreadsheets.values.append({
    spreadsheetId: sheetId(),
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

export async function updateRow(tabName, sheetRowNumber, row) {
  // sheetRowNumber is 1-based (row 1 = headers, row 2 = first data row)
  const client = getClient();
  await client.spreadsheets.values.update({
    spreadsheetId: sheetId(),
    range: `${tabName}!A${sheetRowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
}

export async function deleteRow(tabName, sheetRowNumber) {
  const client = getClient();
  const meta = await client.spreadsheets.get({ spreadsheetId: sheetId() });
  const sheet = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!sheet) throw new Error(`Tab "${tabName}" not found`);
  const sheetId = sheet.properties.sheetId;

  await client.spreadsheets.batchUpdate({
    spreadsheetId: sheetId(),
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: sheetRowNumber - 1, // 0-based, inclusive
            endIndex: sheetRowNumber,        // 0-based, exclusive
          },
        },
      }],
    },
  });
}

export function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))
  );
}

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ─── Sheet initialization ─────────────────────────────────────────────────────

// Creates a brand-new spreadsheet under the authorized user's own Google account
// and returns its ID. Used by `npm run setup` so nobody has to hand-build the
// sheet or share it with anything — it's just theirs from the start.
export async function createSpreadsheet(title = 'Telegram Assistant Bot Data') {
  const client = getClient();
  const res = await client.spreadsheets.create({
    requestBody: { properties: { title } },
  });
  return res.data.spreadsheetId;
}

export async function initializeSheets() {
  // Create any missing tabs first, so new features work without manual sheet setup
  try {
    const client = getClient();
    const meta = await client.spreadsheets.get({ spreadsheetId: sheetId() });
    const existing = new Set(meta.data.sheets.map(s => s.properties.title));
    const missing = Object.keys(HEADERS).filter(tab => !existing.has(tab));

    if (missing.length > 0) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId: sheetId(),
        requestBody: {
          requests: missing.map(title => ({ addSheet: { properties: { title } } })),
        },
      });
      console.log(`[sheets] Created missing tabs: ${missing.join(', ')}`);
    }
  } catch (err) {
    console.error('[sheets] Error creating missing tabs:', err.message);
  }

  for (const [tab, headers] of Object.entries(HEADERS)) {
    try {
      const rows = await getSheetData(tab);
      if (!rows || rows.length === 0) {
        await appendRow(tab, headers);
        console.log(`[sheets] Initialized headers for tab: ${tab}`);
      }
    } catch (err) {
      console.error(`[sheets] Error initializing tab ${tab}:`, err.message);
    }
  }
}

// ─── DailyGoals ───────────────────────────────────────────────────────────────

export async function getDailyGoals(activeOnly = true) {
  const rows = await getSheetData(TABS.DAILY_GOALS);
  const goals = rowsToObjects(rows);
  return activeOnly ? goals.filter(g => g.active === 'TRUE') : goals;
}

export async function removeDailyGoal(text) {
  const rows = await getSheetData(TABS.DAILY_GOALS);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const textCol = headers.indexOf('text');
  const rowIndex = dataRows.findIndex(r => r[textCol]?.toLowerCase() === text.toLowerCase());
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2;
  const existing = Object.fromEntries(headers.map((h, i) => [h, dataRows[rowIndex][i] ?? '']));
  await updateRow(TABS.DAILY_GOALS, sheetRow, [existing.id, existing.text, existing.created_date, 'FALSE']);
  console.log(`[sheets] Deactivated daily goal: "${text}"`);
  return true;
}

export async function addDailyGoal(text) {
  const id = randomUUID();
  const created = todayString();
  await appendRow(TABS.DAILY_GOALS, [id, text, created, 'TRUE']);
  console.log(`[sheets] Added daily goal: "${text}" (id=${id})`);
  return { id, text, created_date: created, active: 'TRUE' };
}

// ─── OneoffGoals ──────────────────────────────────────────────────────────────

export async function removeOneoffGoal(text) {
  const rows = await getSheetData(TABS.ONEOFF_GOALS);
  if (!rows || rows.length < 2) return { removed: false };

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const textCol = headers.indexOf('text');
  const doneCol = headers.indexOf('done');
  const rowIndex = dataRows.findIndex(r => r[textCol]?.toLowerCase() === text.toLowerCase());

  if (rowIndex === -1) return { removed: false };
  if (dataRows[rowIndex][doneCol] === 'TRUE') return { removed: false, alreadyDone: true };

  const sheetRow = rowIndex + 2;
  await deleteRow(TABS.ONEOFF_GOALS, sheetRow);
  console.log(`[sheets] Deleted one-off goal: "${text}"`);
  return { removed: true };
}

export async function getOneoffGoals(undoneOnly = true) {
  const rows = await getSheetData(TABS.ONEOFF_GOALS);
  const goals = rowsToObjects(rows);
  return undoneOnly ? goals.filter(g => g.done !== 'TRUE') : goals;
}

export async function addOneoffGoal(text) {
  const id = randomUUID();
  const created = todayString();
  await appendRow(TABS.ONEOFF_GOALS, [id, text, 'FALSE', created, '']);
  console.log(`[sheets] Added one-off goal: "${text}" (id=${id})`);
  return { id, text, done: 'FALSE', created_date: created, done_date: '' };
}

export async function markOneoffDone(id) {
  const rows = await getSheetData(TABS.ONEOFF_GOALS);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const idCol = headers.indexOf('id');
  const rowIndex = dataRows.findIndex(r => r[idCol] === id);

  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-based indexing
  const existing = Object.fromEntries(headers.map((h, i) => [h, dataRows[rowIndex][i] ?? '']));
  await updateRow(TABS.ONEOFF_GOALS, sheetRow, [
    existing.id,
    existing.text,
    'TRUE',
    existing.created_date,
    todayString(),
  ]);
  console.log(`[sheets] Marked one-off goal done: id=${id}`);
  return true;
}

// ─── DailyLog ─────────────────────────────────────────────────────────────────

export async function getLogForDate(date) {
  const rows = await getSheetData(TABS.DAILY_LOG);
  const logs = rowsToObjects(rows);
  return logs.find(l => l.date === date) || null;
}

export async function upsertLogForDate(date, data) {
  const rows = await getSheetData(TABS.DAILY_LOG);
  if (!rows || rows.length < 1) return;

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const dateCol = headers.indexOf('date');
  const rowIndex = dataRows.findIndex(r => r[dateCol] === date);

  const buildRow = (existing = {}) => [
    date,
    data.completed_daily_goal_ids ?? existing.completed_daily_goal_ids ?? '',
    data.completed_oneoff_ids ?? existing.completed_oneoff_ids ?? '',
    data.notes ?? existing.notes ?? '',
    data.all_daily_hit !== undefined
      ? (data.all_daily_hit ? 'TRUE' : 'FALSE')
      : (existing.all_daily_hit ?? 'FALSE'),
  ];

  if (rowIndex === -1) {
    await appendRow(TABS.DAILY_LOG, buildRow());
    console.log(`[sheets] Created DailyLog entry for ${date}`);
  } else {
    const existing = Object.fromEntries(headers.map((h, i) => [h, dataRows[rowIndex][i] ?? '']));
    const sheetRow = rowIndex + 2;
    await updateRow(TABS.DAILY_LOG, sheetRow, buildRow(existing));
    console.log(`[sheets] Updated DailyLog entry for ${date}`);
  }
}

export async function getAllLogs() {
  const rows = await getSheetData(TABS.DAILY_LOG);
  return rowsToObjects(rows);
}

// ─── NewsLog ──────────────────────────────────────────────────────────────────

export async function logNewsSent(date, summary) {
  const rows = await getSheetData(TABS.NEWS_LOG);
  if (!rows || rows.length < 1) return;

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const dateCol = headers.indexOf('date');
  const rowIndex = dataRows.findIndex(r => r[dateCol] === date);

  if (rowIndex === -1) {
    await appendRow(TABS.NEWS_LOG, [date, summary]);
  } else {
    const sheetRow = rowIndex + 2;
    await updateRow(TABS.NEWS_LOG, sheetRow, [date, summary]);
  }
}
