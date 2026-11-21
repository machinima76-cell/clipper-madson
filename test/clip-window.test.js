const test = require('node:test');
const assert = require('node:assert/strict');
const clipWindow = require('../src/clip-window');

test('mantém a duração no início, meio e fim da mídia', () => {
  assert.deepEqual(clipWindow(2, 100, 30), { start: 0, end: 30 });
  assert.deepEqual(clipWindow(50, 100, 30), { start: 35, end: 65 });
  assert.deepEqual(clipWindow(99, 100, 30), { start: 70, end: 100 });
});

test('respeita fontes curtas e duração personalizada', () => {
  assert.deepEqual(clipWindow(5, 12.5, 30), { start: 0, end: 12.5 });
  assert.deepEqual(clipWindow(20, 60, 10), { start: 15, end: 25 });
});
