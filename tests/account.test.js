import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSIGNABLE_STAFF_ROLES, PERMISSION_CATALOGUE, assertCustomer, assertStaffEditable, permissionMatrix } from '../services/accountService.js';

const owner = { _id: 'o1', role: 'owner' };
const manager = { _id: 'm1', role: 'manager' };

test('nobody edits the owner account through the API', () => {
  assert.throws(() => assertStaffEditable(manager, { _id: 'o1', role: 'owner' }), (e) => e.code === 'OWNER_PROTECTED');
  assert.throws(() => assertStaffEditable(owner, { _id: 'o1', role: 'owner' }), (e) => e.code === 'OWNER_PROTECTED');
});

test('nobody changes their own role or status', () => {
  assert.throws(() => assertStaffEditable(owner, { _id: 'o1', role: 'manager' }), (e) => e.code === 'SELF_CHANGE');
  assert.throws(() => assertStaffEditable({ id: 'm1' }, { id: 'm1', role: 'chef' }), (e) => e.code === 'SELF_CHANGE');
});

test('the staff routes refuse customer accounts, and the customer routes refuse staff accounts', () => {
  assert.throws(() => assertStaffEditable(owner, { _id: 'c1', role: 'customer' }), (e) => e.code === 'NOT_STAFF');
  assert.throws(() => assertStaffEditable(owner, null), (e) => e.code === 'NOT_STAFF');
  assert.throws(() => assertCustomer({ _id: 'x', role: 'chef' }), (e) => e.code === 'NOT_CUSTOMER');
  assert.doesNotThrow(() => assertCustomer({ _id: 'c1', role: 'customer' }));
  assert.doesNotThrow(() => assertStaffEditable(owner, { _id: 'c2', role: 'chef' }));
});

test('an owner can hand out manager, chef and delivery, never owner', () => {
  assert.deepEqual([...ASSIGNABLE_STAFF_ROLES].sort(), ['chef', 'delivery', 'manager']);
});

test('the permission matrix is computed from the real rules', () => {
  const { roles, rows } = permissionMatrix();
  assert.deepEqual(roles.map((r) => r.key), ['owner', 'manager', 'chef', 'delivery']);
  assert.equal(rows.length, PERMISSION_CATALOGUE.length);
  const row = (permission) => rows.find((r) => r.permission === permission).roles;
  assert.deepEqual(row('settings:update'), { owner: true, manager: false, chef: false, delivery: false });
  assert.deepEqual(row('staff:update'), { owner: true, manager: false, chef: false, delivery: false });
  assert.deepEqual(row('orders:progress'), { owner: true, manager: true, chef: true, delivery: false });
  assert.deepEqual(row('menu:availability'), { owner: true, manager: true, chef: true, delivery: false });
  assert.deepEqual(row('deliveries:update'), { owner: true, manager: false, chef: false, delivery: true });
  assert.equal(row('audit:read').chef, false);
  assert.equal(row('audit:read').manager, true);
  assert.ok(rows.every((r) => r.roles.owner), 'an owner can do everything in the catalogue');
});
