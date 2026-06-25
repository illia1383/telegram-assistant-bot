import { google } from 'googleapis';
import { readFileSync } from 'fs';

const TAB = 'Sheet1';

function getClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const credentials = raw.trim().startsWith('{')
    ? JSON.parse(raw)
    : JSON.parse(readFileSync(raw, 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = () => process.env.JOB_SHEET_ID;

async function getAllRows() {
  const client = getClient();
  const res = await client.spreadsheets.values.get({
    spreadsheetId: SHEET_ID(),
    range: `${TAB}!A:C`,
  });
  return res.data.values || [];
}

export async function addApplication(company, dateApplied) {
  const client = getClient();
  await client.spreadsheets.values.append({
    spreadsheetId: SHEET_ID(),
    range: `${TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[company, dateApplied, 'Waiting']] },
  });
  console.log(`[jobs] Added application: ${company} on ${dateApplied}`);
}

export async function updateStatus(company, status) {
  const rows = await getAllRows();
  if (!rows || rows.length < 2) return false;

  // Skip header row, find by company name (case-insensitive)
  const dataRows = rows.slice(1);
  const rowIndex = dataRows.findIndex(r => r[0]?.toLowerCase() === company.toLowerCase());
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-based
  const client = getClient();
  await client.spreadsheets.values.update({
    spreadsheetId: SHEET_ID(),
    range: `${TAB}!C${sheetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
  console.log(`[jobs] Updated ${company} status to ${status}`);
  return true;
}

export async function getApplications(filterStatus = null) {
  const rows = await getAllRows();
  if (!rows || rows.length < 2) return [];

  const dataRows = rows.slice(1);
  const apps = dataRows.map(r => ({
    company: r[0] ?? '',
    dateApplied: r[1] ?? '',
    status: r[2] ?? '',
  })).filter(a => a.company);

  return filterStatus
    ? apps.filter(a => a.status.toLowerCase() === filterStatus.toLowerCase())
    : apps;
}
