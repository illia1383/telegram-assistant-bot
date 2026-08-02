import { TABS, getSheetData, appendRow, updateRow, rowsToObjects } from './sheets.js';

export async function addApplication(company, dateApplied) {
  await appendRow(TABS.JOB_APPLICATIONS, [company, dateApplied, 'Waiting']);
  console.log(`[jobs] Added application: ${company} on ${dateApplied}`);
}

export async function updateStatus(company, status) {
  const rows = await getSheetData(TABS.JOB_APPLICATIONS);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const companyCol = headers.indexOf('company');
  const rowIndex = dataRows.findIndex(r => r[companyCol]?.toLowerCase() === company.toLowerCase());
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2; // +1 for header, +1 for 1-based
  const existing = Object.fromEntries(headers.map((h, i) => [h, dataRows[rowIndex][i] ?? '']));
  await updateRow(TABS.JOB_APPLICATIONS, sheetRow, [existing.company, existing.dateApplied, status]);
  console.log(`[jobs] Updated ${company} status to ${status}`);
  return true;
}

export async function getApplications(filterStatus = null) {
  const rows = await getSheetData(TABS.JOB_APPLICATIONS);
  const apps = rowsToObjects(rows).filter(a => a.company);

  return filterStatus
    ? apps.filter(a => a.status.toLowerCase() === filterStatus.toLowerCase())
    : apps;
}
