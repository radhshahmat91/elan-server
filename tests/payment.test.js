import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSandboxCallback, verifySignature } from '../services/paymentService.js';
import { hmacHex } from '../utils/crypto.js';
import { env } from '../config/env.js';

const payment = { sessionId: 'sbx_test_session', amount: 1170, currency: 'BDT' };
const order = { orderNumber: 'EL-261105-1234' };

test('a sandbox callback is signed over its exact raw body', () => {
  const cb = buildSandboxCallback({ payment, order, outcome: 'succeeded' });
  assert.equal(cb.event.type, 'payment.succeeded');
  assert.equal(cb.event.amount, 1170);
  assert.equal(verifySignature(cb.rawBody, cb.signature), true);
  assert.equal(cb.signature, hmacHex(env.PAYMENT_WEBHOOK_SECRET, cb.rawBody));
});

test('any change to the body invalidates the signature (amount tampering)', () => {
  const cb = buildSandboxCallback({ payment, order, outcome: 'succeeded' });
  const tampered = cb.rawBody.replace('"amount":1170', '"amount":1');
  assert.notEqual(tampered, cb.rawBody);
  assert.equal(verifySignature(tampered, cb.signature), false);
});

test('missing or wrong signatures and a wrong secret are rejected', () => {
  const cb = buildSandboxCallback({ payment, order, outcome: 'failed' });
  assert.equal(verifySignature(cb.rawBody, ''), false);
  assert.equal(verifySignature(cb.rawBody, undefined), false);
  assert.equal(verifySignature('', cb.signature), false);
  assert.equal(verifySignature(cb.rawBody, 'a'.repeat(64)), false);
  assert.equal(verifySignature(cb.rawBody, cb.signature, 'another-secret-another-secret'), false);
});

test('every callback carries a fresh event id (needed for idempotency)', () => {
  const a = buildSandboxCallback({ payment, order, outcome: 'succeeded' });
  const b = buildSandboxCallback({ payment, order, outcome: 'succeeded' });
  assert.notEqual(a.event.eventId, b.event.eventId);
});

test('buffers and strings verify the same way', () => {
  const cb = buildSandboxCallback({ payment, order, outcome: 'cancelled' });
  assert.equal(verifySignature(Buffer.from(cb.rawBody), cb.signature), true);
});
