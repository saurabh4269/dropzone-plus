// DropZone Alexa skill handlers, run through ask-sdk-core with real request envelopes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { req } from './req.mjs';
import { replayVerdict, checkZoneReply, consentReply } from '../lambda/logic.mjs';

process.env.DZ_SCENARIO = 'saturday';
process.env.DZ_T = '20';
delete process.env.DROPZONE_URL;
const { handler } = await import('../lambda/index.mjs');
const invoke = (e) => new Promise((res, rej) => handler(e, {}, (err, out) => (err ? rej(err) : res(out))));
const speech = (o) => o.response.outputSpeech.ssml;

test('launch greets and keeps the session open', async () => {
  const o = await invoke(req('LaunchRequest', null, {}, true));
  assert.match(speech(o), /Ask me if the yard is clear/);
  assert.equal(o.response.shouldEndSession, false);
});

test('CheckZoneIntent on the replay frame: dog in zone, offers pet door, says it is simulated', async () => {
  const o = await invoke(req('IntentRequest', 'CheckZoneIntent'));
  assert.match(speech(o), /pet door/);
  assert.match(speech(o), /simulated replay frame/);
  assert.equal(o.sessionAttributes.pending, 'petdoor.in_only');
  const y = await invoke(req('IntentRequest', 'AMAZON.YesIntent', o.sessionAttributes));
  assert.match(speech(y), /come-in-only/);
  assert.match(speech(y), /simulated device/);
});

test('No means no device change', async () => {
  const o = await invoke(req('IntentRequest', 'AMAZON.NoIntent', { pending: 'lights.on' }));
  assert.match(speech(o), /won't change anything/);
});

test('Yes with nothing pending does nothing', () => {
  assert.equal(consentReply(null, true).acted, undefined);
});

test('lights and sprinkler offers ask first, act only on yes', async () => {
  for (const [intent, action, word] of [['YardLightsIntent', 'lights.on', /yard lights are on/], ['SprinklerPauseIntent', 'sprinkler.pause', /paused the sprinklers/]]) {
    const o = await invoke(req('IntentRequest', intent));
    assert.equal(o.sessionAttributes.pending, action);
    const y = await invoke(req('IntentRequest', 'AMAZON.YesIntent', o.sessionAttributes));
    assert.match(speech(y), word);
  }
});

test('HoldDroneIntent: NOT_CLEAR replay gives a HOLD and leaves the call to the carrier', async () => {
  const o = await invoke(req('IntentRequest', 'HoldDroneIntent'));
  assert.match(speech(o), /asked the drone to wait/);
  assert.match(speech(o), /carrier still makes the final call/);
});

test('unreadable frame is UNKNOWN, never clear', () => {
  const v = replayVerdict({ scenario: 'unknown', t: 20 });
  assert.equal(v.verdict.status, 'UNKNOWN');
  assert.doesNotMatch(checkZoneReply(v).speech, /looks clear/);
});

test('live source failure falls back to UNKNOWN, never CLEAR', async () => {
  process.env.DROPZONE_URL = 'http://127.0.0.1:1';
  const { currentVerdict } = await import('../lambda/logic.mjs');
  const v = await currentVerdict();
  delete process.env.DROPZONE_URL;
  assert.equal(v.verdict, null);
  assert.match(checkZoneReply(v).speech, /can't see the drop zone/);
});
