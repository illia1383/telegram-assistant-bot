import { getAllLogs } from './sheets.js';

// ─── Core streak logic ────────────────────────────────────────────────────────
// Exported separately so it can be unit-tested without hitting the Sheets API.

const ONE_DAY_MS = 86_400_000;

// DailyLog rows are dated using the app's configured TIMEZONE (see todayString()
// in sheets.js/commands.js/agent-tools.js), not UTC. Formatting "today" via
// toISOString() here used to disagree with that near UTC midnight — e.g. around
// 8pm America/New_York, UTC's calendar day has already flipped while the user's
// hasn't, so streaks flickered depending on exactly when a request landed.
function fmtInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

export function calculateStreaks(logs, timezone = process.env.TIMEZONE || 'America/New_York', now = new Date()) {
  const hitDates = new Set(
    logs.filter(l => l.all_daily_hit === 'TRUE').map(l => l.date)
  );

  if (hitDates.size === 0) return { current: 0, best: 0 };

  const todayStr = fmtInTz(now, timezone);

  // If today isn't logged as a hit yet, don't penalise — start counting from yesterday.
  let cursorMs = now.getTime();
  if (!hitDates.has(todayStr)) {
    cursorMs -= ONE_DAY_MS;
  }

  // Current streak: walk backward from the start date
  let current = 0;
  while (hitDates.has(fmtInTz(new Date(cursorMs), timezone))) {
    current++;
    cursorMs -= ONE_DAY_MS;
  }

  // Best streak: scan the sorted list for the longest consecutive run
  const sorted = [...hitDates].sort(); // lexicographic sort works for ISO dates
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((curr - prev) / 86_400_000);
    if (diffDays === 1) {
      run++;
      if (run > best) best = run;
    } else {
      run = 1;
    }
  }

  return { current, best };
}

// ─── Convenience wrapper that fetches logs automatically ──────────────────────

export async function getStreaks() {
  const logs = await getAllLogs();
  return calculateStreaks(logs);
}
