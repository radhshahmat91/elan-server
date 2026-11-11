import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_FLOW, canTransition } from '../services/orderService.js';

const order = (over = {}) => ({ status: 'placed', fulfillment: 'delivery', user: 'u1', assignedDelivery: null, ...over });
const as = (role, id = 'x1') => ({ role, id });
const allowed = (o, to, actor) => canTransition(o, to, actor).ok;

test('the flow never leaves a final state', () => {
  for (const final of ['delivered', 'cancelled', 'rejected']) assert.deepEqual(STATUS_FLOW[final], []);
});

test('managers and owners can make any valid move, but not invalid ones', () => {
  for (const role of ['manager', 'owner']) {
    assert.equal(allowed(order(), 'confirmed', as(role)), true);
    assert.equal(allowed(order({ status: 'confirmed' }), 'cancelled', as(role)), true);
    assert.equal(allowed(order(), 'delivered', as(role)), false);
    assert.equal(allowed(order({ status: 'delivered' }), 'cancelled', as(role)), false);
  }
});

test('the kitchen moves orders forward but cannot cancel or deliver by rider', () => {
  assert.equal(allowed(order(), 'confirmed', as('chef')), true);
  assert.equal(allowed(order(), 'rejected', as('chef')), true);
  assert.equal(allowed(order({ status: 'confirmed' }), 'preparing', as('chef')), true);
  assert.equal(allowed(order({ status: 'preparing' }), 'ready', as('chef')), true);
  assert.equal(allowed(order({ status: 'confirmed' }), 'cancelled', as('chef')), false);
  assert.equal(allowed(order({ status: 'ready' }), 'out_for_delivery', as('chef')), false);
  // a chef can hand over pickup orders
  assert.equal(allowed(order({ status: 'ready', fulfillment: 'pickup' }), 'delivered', as('chef')), true);
});

test('delivery orders must go out with a rider; pickup and dine-in cannot', () => {
  assert.equal(canTransition(order({ status: 'ready' }), 'delivered', as('manager')).ok, false);
  assert.equal(canTransition(order({ status: 'ready', fulfillment: 'pickup' }), 'out_for_delivery', as('manager')).ok, false);
  assert.equal(canTransition(order({ status: 'ready', fulfillment: 'dine_in' }), 'delivered', as('manager')).ok, true);
});

test('riders can only pick up and complete their own deliveries', () => {
  const ready = order({ status: 'ready' });
  assert.equal(allowed(ready, 'out_for_delivery', as('delivery', 'r1')), true);
  assert.equal(allowed({ ...ready, assignedDelivery: 'r2' }, 'out_for_delivery', as('delivery', 'r1')), false);
  const travelling = order({ status: 'out_for_delivery', assignedDelivery: 'r1' });
  assert.equal(allowed(travelling, 'delivered', as('delivery', 'r1')), true);
  assert.equal(allowed(travelling, 'delivered', as('delivery', 'r2')), false);
  assert.equal(allowed(order(), 'confirmed', as('delivery', 'r1')), false);
});

test('customers can cancel only their own order, and only before the kitchen confirms', () => {
  assert.equal(allowed(order(), 'cancelled', as('customer', 'u1')), true);
  assert.equal(allowed(order({ status: 'pending_payment' }), 'cancelled', as('customer', 'u1')), true);
  assert.equal(allowed(order(), 'cancelled', as('customer', 'someone-else')), false);
  assert.equal(allowed(order({ status: 'confirmed' }), 'cancelled', as('customer', 'u1')), false);
  assert.equal(allowed(order(), 'confirmed', as('customer', 'u1')), false);
});

test('guests can cancel guest orders only', () => {
  assert.equal(allowed(order({ user: null }), 'cancelled', { role: 'guest' }), true);
  assert.equal(allowed(order({ user: 'u1' }), 'cancelled', { role: 'guest' }), false);
});

test('unknown roles are denied with 403', () => {
  const verdict = canTransition(order(), 'confirmed', { role: 'visitor' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 403);
});
