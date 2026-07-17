import { randomUUID } from 'crypto';
import cron from 'node-cron';
import { getSheetData, appendRow, updateRow, rowsToObjects } from './sheets.js';
import { sendMessage } from './telegram.js';

const TAB = 'Automations';

// Live node-cron task handles, keyed by automation id, so we can stop them
// when an automation is deleted without restarting the server.
const scheduled = new Map();

function todayString() {
  const tz = process.env.TIMEZONE || 'America/New_York';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ─── User-defined recurring automations ───────────────────────────────────────
// Each automation is a cron schedule + a natural-language prompt. On each tick
// the prompt is run through the assistant agent and the result is sent to you.
// Example: "every weekday at 7am" + "summarize my unread emails"

function scheduleOne(automation) {
  if (scheduled.has(automation.id)) return;

  const task = cron.schedule(
    automation.cron,
    async () => {
      console.log(`[automations] Running "${automation.description}" (id=${automation.id})`);
      try {
        // Dynamic import avoids a circular dependency (agent.js exposes automation tools)
        const { runAgent } = await import('./agent.js');
        const result = await runAgent(automation.prompt, { isolated: true });
        await sendMessage(`🤖 *${automation.description}*\n\n${result}`);
      } catch (err) {
        console.error(`[automations] Run failed (id=${automation.id}):`, err.message);
        await sendMessage(`⚠️ Automation "${automation.description}" failed: ${err.message}`);
      }
    },
    { timezone: process.env.TIMEZONE || 'America/New_York' }
  );

  scheduled.set(automation.id, task);
}

export async function createAutomation(description, cronExpr, prompt) {
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: "${cronExpr}"`);
  }
  const id = randomUUID().slice(0, 8);
  await appendRow(TAB, [id, description, cronExpr, prompt, 'TRUE', todayString()]);

  const automation = { id, description, cron: cronExpr, prompt, active: 'TRUE' };
  scheduleOne(automation);
  console.log(`[automations] Created "${description}" (${cronExpr}) id=${id}`);
  return automation;
}

export async function getAutomations(activeOnly = true) {
  const rows = await getSheetData(TAB);
  const automations = rowsToObjects(rows).filter(a => a.id);
  return activeOnly ? automations.filter(a => a.active === 'TRUE') : automations;
}

export async function deleteAutomation(id) {
  const rows = await getSheetData(TAB);
  if (!rows || rows.length < 2) return false;

  const headers = rows[0];
  const idCol = headers.indexOf('id');
  const rowIndex = rows.slice(1).findIndex(r => r[idCol] === id);
  if (rowIndex === -1) return false;

  const existing = Object.fromEntries(headers.map((h, i) => [h, rows[rowIndex + 1][i] ?? '']));
  await updateRow(TAB, rowIndex + 2, [existing.id, existing.description, existing.cron, existing.prompt, 'FALSE', existing.created_date]);

  const task = scheduled.get(id);
  if (task) {
    task.stop();
    scheduled.delete(id);
  }
  console.log(`[automations] Deactivated id=${id}`);
  return true;
}

// Called once at boot to schedule all active automations from the sheet
export async function loadAutomations() {
  try {
    const automations = await getAutomations(true);
    for (const a of automations) {
      if (!cron.validate(a.cron)) {
        console.error(`[automations] Skipping invalid cron "${a.cron}" (id=${a.id})`);
        continue;
      }
      scheduleOne(a);
    }
    console.log(`[automations] Loaded ${automations.length} active automation(s)`);
  } catch (err) {
    console.error('[automations] Failed to load automations:', err.message);
  }
}
