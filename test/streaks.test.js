import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreaks } from '../src/streaks.js';

const TZ = 'America/New_York';
const NOW = new Date('2026-07-23T18:00:00Z'); // 2pm EDT, well clear of any day boundary

const iso = (daysAgo) => {
  const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
};

const hit = (daysAgo) => ({ date: iso(daysAgo), all_daily_hit: 'TRUE' });
const miss = (daysAgo) => ({ date: iso(daysAgo), all_daily_hit: 'FALSE' });

const streaks = (logs, now = NOW) => calculateStreaks(logs, TZ, now);

test('no logs → zero streaks', () => {
  assert.deepEqual(streaks([]), { current: 0, best: 0 });
});

test('misses only → zero streaks', () => {
  assert.deepEqual(streaks([miss(0), miss(1)]), { current: 0, best: 0 });
});

test('consecutive hits ending today', () => {
  assert.deepEqual(streaks([hit(0), hit(1), hit(2)]), { current: 3, best: 3 });
});

test('today not logged yet does not break the streak', () => {
  assert.deepEqual(streaks([hit(1), hit(2)]), { current: 2, best: 2 });
});

test('gap resets current but best remembers the longer run', () => {
  const logs = [hit(0), hit(1), hit(3), hit(4), hit(5)];
  assert.deepEqual(streaks(logs), { current: 2, best: 3 });
});

test('broken streak two days ago → current is zero', () => {
  assert.deepEqual(streaks([hit(2), hit(3)]), { current: 0, best: 2 });
});

test('streak is stable across a UTC midnight boundary within the same local day', () => {
  // Regression test for the flicker reported in production: streaks.js used to
  // format "today" via toISOString() (UTC), which disagreed with the app's
  // TIMEZONE-based date convention used to write DailyLog rows. Around 8pm
  // America/New_York, UTC's calendar day flips a day early relative to the
  // user's — under the old UTC-based code this instant pair actually produced
  // different results (3 vs 0): the second instant's UTC "today" (a day that
  // doesn't exist in the log yet) fell back to a UTC "yesterday" that lands on
  // this test's real miss day, wiping the streak to 0. Both instants are still
  // July 23rd in America/New_York, so the fixed implementation must agree.
  const logs = [hit(1), hit(2), hit(3)]; // 3-day streak ending yesterday; today (23rd) not yet logged
  const beforeUtcMidnight = new Date('2026-07-23T23:30:00Z'); // 7:30pm EDT, July 23
  const afterUtcMidnight = new Date('2026-07-24T02:00:00Z');  // 10:00pm EDT, still July 23
  assert.deepEqual(streaks(logs, beforeUtcMidnight), { current: 3, best: 3 });
  assert.deepEqual(streaks(logs, afterUtcMidnight), { current: 3, best: 3 });
});
