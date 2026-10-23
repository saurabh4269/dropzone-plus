import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, resetState } from '../lambda/index.mjs';
import { dir } from './samples.mjs';

const val = (r, n) => r.context.properties.find((p) => p.name === n).value;

test('discovery returns three virtual endpoints', async () => {
  const r = await handler(dir('Alexa.Discovery', 'Discover'));
  assert.equal(r.event.header.name, 'Discover.Response');
  assert.deepEqual(r.event.payload.endpoints.map((e) => e.friendlyName), ['Yard Lights', 'Sprinkler', 'Pet Door']);
  for (const e of r.event.payload.endpoints) assert.match(e.description, /not real hardware/);
});
test('TurnOn yard lights then ReportState', async () => {
  resetState();
  const r = await handler(dir('Alexa.PowerController', 'TurnOn', 'dz-yard-lights'));
  assert.equal(r.event.header.name, 'Response');
  assert.equal(r.event.header.correlationToken, 'ct-1');
  assert.equal(val(r, 'powerState'), 'ON');
  const s = await handler(dir('Alexa', 'ReportState', 'dz-yard-lights'));
  assert.equal(s.event.header.name, 'StateReport');
  assert.equal(val(s, 'powerState'), 'ON');
});
test('sprinkler off, pet door lock/unlock', async () => {
  resetState();
  assert.equal(val(await handler(dir('Alexa.PowerController', 'TurnOff', 'dz-sprinkler')), 'powerState'), 'OFF');
  assert.equal(val(await handler(dir('Alexa.LockController', 'Lock', 'dz-pet-door')), 'lockState'), 'LOCKED');
  assert.equal(val(await handler(dir('Alexa.LockController', 'Unlock', 'dz-pet-door')), 'lockState'), 'UNLOCKED');
});
test('errors for unknown endpoint and wrong interface', async () => {
  assert.equal((await handler(dir('Alexa.PowerController', 'TurnOn', 'nope'))).event.payload.type, 'NO_SUCH_ENDPOINT');
  assert.equal((await handler(dir('Alexa.LockController', 'Lock', 'dz-sprinkler'))).event.payload.type, 'INVALID_DIRECTIVE');
});
test('AcceptGrant acknowledged', async () => {
  const r = await handler({ directive: { header: { namespace: 'Alexa.Authorization', name: 'AcceptGrant', payloadVersion: '3', messageId: 'x' }, payload: {} } });
  assert.equal(r.event.header.name, 'AcceptGrant.Response');
});
