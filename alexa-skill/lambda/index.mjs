// DropZone classic Alexa custom skill (invocation "drop zone"), AWS Lambda handler, ask-sdk-core.
import Alexa from 'ask-sdk-core';
import { currentVerdict, checkZoneReply, holdReply, consentReply, OFFERS } from './logic.mjs';

const is = (h, type, name) => Alexa.getRequestType(h.requestEnvelope) === type && (!name || Alexa.getIntentName(h.requestEnvelope) === name);
const respond = (h, r) => {
  const attrs = h.attributesManager.getSessionAttributes();
  attrs.pending = r.pending || null;
  h.attributesManager.setSessionAttributes(attrs);
  const b = h.responseBuilder.speak(r.speech).withSimpleCard('DropZone', r.speech);
  if (!r.end) b.reprompt(r.reprompt || 'You can ask me if the yard is clear.');
  return b.withShouldEndSession(!!r.end).getResponse();
};

const Launch = { canHandle: (h) => is(h, 'LaunchRequest'), handle: (h) => respond(h, { speech: 'DropZone is watching your drop zone. Ask me if the yard is clear, or ask the drone to wait.', reprompt: 'Ask me if the yard is clear.' }) };
const CheckZone = { canHandle: (h) => is(h, 'IntentRequest', 'CheckZoneIntent'), async handle(h) { return respond(h, checkZoneReply(await currentVerdict())); } };
const HoldDrone = { canHandle: (h) => is(h, 'IntentRequest', 'HoldDroneIntent'), async handle(h) { return respond(h, holdReply(await currentVerdict())); } };
const offer = (intent, action) => ({ canHandle: (h) => is(h, 'IntentRequest', intent), handle: (h) => respond(h, { speech: OFFERS[action], reprompt: OFFERS[action], pending: action }) });
const PetDoor = offer('PetDoorIntent', 'petdoor.in_only');
const Lights = offer('YardLightsIntent', 'lights.on');
const Sprinkler = offer('SprinklerPauseIntent', 'sprinkler.pause');
const Consent = {
  canHandle: (h) => is(h, 'IntentRequest', 'AMAZON.YesIntent') || is(h, 'IntentRequest', 'AMAZON.NoIntent'),
  handle(h) {
    const pending = h.attributesManager.getSessionAttributes().pending;
    return respond(h, consentReply(pending, Alexa.getIntentName(h.requestEnvelope) === 'AMAZON.YesIntent'));
  },
};
const Help = { canHandle: (h) => is(h, 'IntentRequest', 'AMAZON.HelpIntent'), handle: (h) => respond(h, { speech: 'Say: is the yard clear. Or: ask the drone to wait. I can also offer to set the pet door, turn on the yard lights, or pause the sprinklers, and I only do it if you say yes.', reprompt: 'Ask me if the yard is clear.' }) };
const Stop = { canHandle: (h) => is(h, 'IntentRequest', 'AMAZON.StopIntent') || is(h, 'IntentRequest', 'AMAZON.CancelIntent'), handle: (h) => respond(h, { speech: 'Okay.', end: true }) };
const Fallback = { canHandle: (h) => is(h, 'IntentRequest', 'AMAZON.FallbackIntent'), handle: (h) => respond(h, { speech: "Sorry, I didn't get that. Ask me if the yard is clear.", reprompt: 'Ask me if the yard is clear.' }) };
const Ended = { canHandle: (h) => is(h, 'SessionEndedRequest'), handle: (h) => h.responseBuilder.getResponse() };
const Errors = { canHandle: () => true, handle: (h, e) => { console.error(e); return h.responseBuilder.speak("Sorry, DropZone hit a problem, so treat the zone as unknown.").getResponse(); } };

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(Launch, CheckZone, HoldDrone, PetDoor, Lights, Sprinkler, Consent, Help, Stop, Fallback, Ended)
  .addErrorHandlers(Errors)
  .withCustomUserAgent('dropzone/0.2.0')
  .lambda();
