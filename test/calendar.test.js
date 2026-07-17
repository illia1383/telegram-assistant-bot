import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFreeSlots } from '../src/calendar.js';

const day = (h, m = 0) => new Date(Date.UTC(2026, 6, 17, h, m));

test('computeFreeSlots: empty calendar → whole day is one slot', () => {
  const slots = computeFreeSlots([], day(9), day(18), 30);
  assert.equal(slots.length, 1);
  assert.deepEqual(slots[0], { start: day(9), end: day(18) });
});

test('computeFreeSlots: gaps around one meeting', () => {
  const busy = [{ start: day(12), end: day(13) }];
  const slots = computeFreeSlots(busy, day(9), day(18), 30);
  assert.deepEqual(slots, [
    { start: day(9), end: day(12) },
    { start: day(13), end: day(18) },
  ]);
});

test('computeFreeSlots: gap shorter than duration is skipped', () => {
  const busy = [
    { start: day(9), end: day(12) },
    { start: day(12, 20), end: day(18) },
  ];
  const slots = computeFreeSlots(busy, day(9), day(18), 30);
  assert.equal(slots.length, 0);
});

test('computeFreeSlots: overlapping meetings are merged via cursor', () => {
  const busy = [
    { start: day(10), end: day(12) },
    { start: day(11), end: day(13) },
  ];
  const slots = computeFreeSlots(busy, day(9), day(18), 30);
  assert.deepEqual(slots, [
    { start: day(9), end: day(10) },
    { start: day(13), end: day(18) },
  ]);
});

test('computeFreeSlots: unsorted busy input is handled', () => {
  const busy = [
    { start: day(14), end: day(15) },
    { start: day(10), end: day(11) },
  ];
  const slots = computeFreeSlots(busy, day(9), day(18), 60);
  assert.equal(slots.length, 3);
  assert.deepEqual(slots[1], { start: day(11), end: day(14) });
});

test('computeFreeSlots: fully booked day → no slots', () => {
  const busy = [{ start: day(9), end: day(18) }];
  assert.equal(computeFreeSlots(busy, day(9), day(18), 15).length, 0);
});
