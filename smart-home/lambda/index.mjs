// DropZone Home: Alexa Smart Home (v3) skill. Three VIRTUAL endpoints, no real hardware is switched.
// State lives in this Lambda container's memory, so it resets on a cold start (documented, by design: no database).
import { randomUUID } from 'node:crypto';

const MANUFACTURER = 'DropZone (virtual device)';
export const ENDPOINTS = [
  { id: 'dz-yard-lights', name: 'Yard Lights', desc: 'Virtual yard lights, DropZone demo (not real hardware)', cat: 'LIGHT', iface: 'PowerController' },
  { id: 'dz-sprinkler', name: 'Sprinkler', desc: 'Virtual sprinkler, DropZone demo (not real hardware)', cat: 'SMARTPLUG', iface: 'PowerController' },
  { id: 'dz-pet-door', name: 'Pet Door', desc: 'Virtual pet door, DropZone demo (not real hardware)', cat: 'SMARTLOCK', iface: 'LockController' },
];
const initial = () => ({ 'dz-yard-lights': 'OFF', 'dz-sprinkler': 'OFF', 'dz-pet-door': 'UNLOCKED' });
let state = initial();
export const resetState = () => { state = initial(); };

const now = () => new Date().toISOString();
const header = (namespace, name, correlationToken) => ({
  namespace, name, payloadVersion: '3', messageId: randomUUID(), ...(correlationToken ? { correlationToken } : {}),
});
const prop = (id) => {
  const ep = ENDPOINTS.find((e) => e.id === id);
  return ep.iface === 'LockController'
    ? { namespace: 'Alexa.LockController', name: 'lockState', value: state[id], timeOfSample: now(), uncertaintyInMilliseconds: 0 }
    : { namespace: 'Alexa.PowerController', name: 'powerState', value: state[id], timeOfSample: now(), uncertaintyInMilliseconds: 0 };
};
const health = () => ({ namespace: 'Alexa.EndpointHealth', name: 'connectivity', value: { value: 'OK' }, timeOfSample: now(), uncertaintyInMilliseconds: 0 });
const cap = (iface, prop) => ({
  type: 'AlexaInterface', interface: `Alexa.${iface}`, version: '3',
  properties: { supported: [{ name: prop }], proactivelyReported: false, retrievable: true },
});

function discovery() {
  return ENDPOINTS.map((e) => ({
    endpointId: e.id, manufacturerName: MANUFACTURER, friendlyName: e.name, description: e.desc,
    displayCategories: [e.cat],
    capabilities: [
      { type: 'AlexaInterface', interface: 'Alexa', version: '3' },
      e.iface === 'LockController' ? cap('LockController', 'lockState') : cap('PowerController', 'powerState'),
      cap('EndpointHealth', 'connectivity'),
    ],
  }));
}

function error(d, type, message) {
  return { event: { header: header('Alexa', 'ErrorResponse', d.header.correlationToken), endpoint: d.endpoint ? { endpointId: d.endpoint.endpointId } : undefined, payload: { type, message } } };
}

export async function handler(event) {
  const d = event.directive;
  if (!d) return { error: 'not a v3 directive' };
  const { namespace, name, correlationToken } = d.header;
  if (namespace === 'Alexa.Discovery' && name === 'Discover') {
    return { event: { header: header('Alexa.Discovery', 'Discover.Response'), payload: { endpoints: discovery() } } };
  }
  if (namespace === 'Alexa.Authorization' && name === 'AcceptGrant') {
    return { event: { header: header('Alexa.Authorization', 'AcceptGrant.Response'), payload: {} } };
  }
  const id = d.endpoint?.endpointId;
  const ep = ENDPOINTS.find((e) => e.id === id);
  if (!ep) return error(d, 'NO_SUCH_ENDPOINT', `unknown endpoint ${id}`);
  const scope = d.endpoint.scope;
  const ok = (respName = 'Response', ns = 'Alexa') => ({
    event: { header: header(ns, respName, correlationToken), endpoint: { scope, endpointId: id }, payload: {} },
    context: { properties: [prop(id), health()] },
  });
  if (namespace === 'Alexa' && name === 'ReportState') return ok('StateReport');
  if (namespace === 'Alexa.PowerController' && ep.iface === 'PowerController') {
    if (name === 'TurnOn') state[id] = 'ON'; else if (name === 'TurnOff') state[id] = 'OFF'; else return error(d, 'INVALID_DIRECTIVE', name);
    console.log(JSON.stringify({ virtual: true, endpoint: id, powerState: state[id] }));
    return ok();
  }
  if (namespace === 'Alexa.LockController' && ep.iface === 'LockController') {
    if (name === 'Lock') state[id] = 'LOCKED'; else if (name === 'Unlock') state[id] = 'UNLOCKED'; else return error(d, 'INVALID_DIRECTIVE', name);
    console.log(JSON.stringify({ virtual: true, endpoint: id, lockState: state[id] }));
    return ok();
  }
  return error(d, 'INVALID_DIRECTIVE', `${namespace}.${name} not supported on ${id}`);
}
