import { getAllLogs } from './sheets.js';

// ─── Core streak logic ────────────────────────────────────────────────────────
// Exported separately so it can be unit-tested without hitting the Sheets API.

export function calculateStreaks(logs) {
  const hitDates = new Set(
    logs.filter(l => l.all_daily_hit === 'TRUE').map(l => l.date)
  );

  if (hitDates.size === 0) return { current: 0, best: 0 };

  const fmt = (d) => d.toISOString().split('T')[0];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = fmt(today);

  // If today isn't logged as a hit yet, don't penalise — start counting from yesterday.
  const startDate = new Date(today);
  if (!hitDates.has(todayStr)) {
    startDate.setDate(startDate.getDate() - 1);
  }

  // Current streak: walk backward from startDate
  let current = 0;
  const cursor = new Date(startDate);
  while (hitDates.has(fmt(cursor))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
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
