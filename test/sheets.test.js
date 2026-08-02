import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToObjects } from '../src/sheets.js';

test('rowsToObjects: converts header + data rows into objects', () => {
  const rows = [
    ['id', 'text', 'active'],
    ['1', 'run 5k', 'TRUE'],
    ['2', 'read', 'FALSE'],
  ];
  assert.deepEqual(rowsToObjects(rows), [
    { id: '1', text: 'run 5k', active: 'TRUE' },
    { id: '2', text: 'read', active: 'FALSE' },
  ]);
});

test('rowsToObjects: short rows fill missing trailing cells with empty string', () => {
  const rows = [
    ['id', 'text', 'active'],
    ['1', 'run 5k'],
  ];
  assert.deepEqual(rowsToObjects(rows), [{ id: '1', text: 'run 5k', active: '' }]);
});

test('rowsToObjects: header-only or empty input returns no rows', () => {
  assert.deepEqual(rowsToObjects([['id', 'text']]), []);
  assert.deepEqual(rowsToObjects([]), []);
  assert.deepEqual(rowsToObjects(undefined), []);
});
