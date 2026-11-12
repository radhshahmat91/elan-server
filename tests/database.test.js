import assert from 'node:assert/strict';
import test from 'node:test';
import { databaseNameOf } from '../config/db.js';
import { explainForeignIndexes, pickUniqueIndexes } from '../utils/indexGuard.js';

test('databaseNameOf reads the database out of a connection string', () => {
  assert.equal(databaseNameOf('mongodb://127.0.0.1:27017/elan'), 'elan');
  assert.equal(databaseNameOf('mongodb://user:pa%40ss@host:27017/elan?authSource=admin'), 'elan');
  assert.equal(databaseNameOf('mongodb+srv://u:p@cluster0.abc.mongodb.net/elan?retryWrites=true&w=majority'), 'elan');
  assert.equal(databaseNameOf('mongodb://host1:27017,host2:27017/shop?replicaSet=rs0'), 'shop');
});

test('databaseNameOf is empty when the string names no database (MongoDB would use "test")', () => {
  assert.equal(databaseNameOf('mongodb://127.0.0.1:27017'), '');
  assert.equal(databaseNameOf('mongodb://127.0.0.1:27017/'), '');
  assert.equal(databaseNameOf('mongodb+srv://u:p@cluster0.abc.mongodb.net/?retryWrites=true&w=majority'), '');
  assert.equal(databaseNameOf('mongodb+srv://u:p@cluster0.abc.mongodb.net?retryWrites=true'), '');
  assert.equal(databaseNameOf(undefined), '');
});

test('pickUniqueIndexes keeps only unique indexes ÉLAN did not ask for', () => {
  const existing = [
    { name: '_id_', key: { _id: 1 } },
    { name: 'booking_1', key: { booking: 1 }, unique: true },
    { name: 'user_1_order_1_menuItem_1', key: { user: 1, order: 1, menuItem: 1 }, unique: true },
    { name: 'createdAt_-1', key: { createdAt: -1 } },
    { name: 'legacy_1', key: { legacy: 1 }, unique: false },
  ];
  const unexpected = ['booking_1', 'createdAt_-1', 'legacy_1'];
  assert.deepEqual(pickUniqueIndexes(existing, unexpected).map((ix) => ix.name), ['booking_1']);
});

test('pickUniqueIndexes never reports the _id index and copes with nothing', () => {
  assert.deepEqual(pickUniqueIndexes([{ name: '_id_', unique: true }], ['_id_']), []);
  assert.deepEqual(pickUniqueIndexes(undefined, undefined), []);
});

test('the explanation names the database, the index and the fix', () => {
  const text = explainForeignIndexes([{ collection: 'reviews', name: 'booking_1', fields: ['booking'] }], 'test');
  assert.match(text, /"test"/);
  assert.match(text, /reviews: booking_1 \(booking\)/);
  assert.match(text, /mongodb:\/\/127\.0\.0\.1:27017\/elan/);
  assert.match(text, /--skip-index-check/);
});
