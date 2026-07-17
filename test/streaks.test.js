import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreaks } from '../src/streaks.js';

const iso = (daysAgo) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
};

const hit = (daysAgo) => ({ date: iso(daysAgo), all_daily_hit: 'TRUE' });
const miss = (daysAgo) => ({ date: iso(daysAgo), all_daily_hit: 'FALSE' });

test('no logs → zero streaks', () => {
  assert.deepEqual(calculateStreaks([]), { current: 0, best: 0 });
});

test('misses only → zero streaks', () => {
  assert.deepEqual(calculateStreaks([miss(0), miss(1)]), { current: 0, best: 0 });
});

test('consecutive hits ending today', () => {
  assert.deepEqual(calculateStreaks([hit(0), hit(1), hit(2)]), { current: 3, best: 3 });
});

test('today not logged yet does not break the streak', () => {
  assert.deepEqual(calculateStreaks([hit(1), hit(2)]), { current: 2, best: 2 });
});

test('gap resets current but best remembers the longer run', () => {
  const logs = [hit(0), hit(1), hit(3), hit(4), hit(5)];
  assert.deepEqual(calculateStreaks(logs), { current: 2, best: 3 });
});

test('broken streak two days ago → current is zero', () => {
  assert.deepEqual(calculateStreaks([hit(2), hit(3)]), { current: 0, best: 2 });
});
