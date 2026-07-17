import { randomUUID } from 'crypto';
import { getSheetData, appendRow, deleteRow, rowsToObjects } from './sheets.js';

const TAB = 'Memory';

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ─── Persistent memory of user facts & preferences ────────────────────────────
// The assistant saves things like "prefers meetings after 2pm" or "sister's
// name is Ana" and they get injected into every agent conversation.

export async function addMemory(fact, category = 'general') {
  const id = randomUUID().slice(0, 8);
  await appendRow(TAB, [id, fact, category, todayString()]);
  console.log(`[memory] Saved: "${fact}" (${category})`);
  return { id, fact, category };
}

export async function getMemories() {
  const rows = await getSheetData(TAB);
  return rowsToObjects(rows).filter(m => m.fact);
}

export async function forgetMemory(id) {
  const rows = await getSheetData(TAB);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const idCol = headers.indexOf('id');
  const rowIndex = rows.slice(1).findIndex(r => r[idCol] === id);
  if (rowIndex === -1) return false;

  await deleteRow(TAB, rowIndex + 2);
  console.log(`[memory] Forgot memory id=${id}`);
  return true;
}

// Formatted block for injection into the agent system prompt
export async function getMemoryContext() {
  try {
    const memories = await getMemories();
    if (memories.length === 0) return '';
    const lines = memories.map(m => `- [${m.id}] (${m.category}) ${m.fact}`);
    return `\n\nTHINGS YOU REMEMBER ABOUT THE USER:\n${lines.join('\n')}`;
  } catch (err) {
    console.error('[memory] Failed to load memories:', err.message);
    return '';
  }
}
