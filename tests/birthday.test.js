import test from 'node:test';
import assert from 'node:assert/strict';
import { birthdayMatches } from '../services/birthdayService.js';

test('a birthday matches its own day', () => {
  assert.deepEqual(birthdayMatches({ year: 2026, month: 11, day: 7 }), [[11, 7]]);
});

test('29 February birthdays are celebrated on the 28th in years without a leap day', () => {
  assert.deepEqual(birthdayMatches({ year: 2027, month: 2, day: 28 }), [[2, 28], [2, 29]]);
  assert.deepEqual(birthdayMatches({ year: 2028, month: 2, day: 28 }), [[2, 28]]);
  assert.deepEqual(birthdayMatches({ year: 2028, month: 2, day: 29 }), [[2, 29]]);
  assert.deepEqual(birthdayMatches({ year: 2100, month: 2, day: 28 }), [[2, 28], [2, 29]], '2100 is not a leap year');
});
