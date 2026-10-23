export const dir = (namespace, name, endpointId) => ({
  directive: {
    header: { namespace, name, payloadVersion: '3', messageId: 'm-1', ...(endpointId ? { correlationToken: 'ct-1' } : {}) },
    ...(endpointId ? { endpoint: { scope: { type: 'BearerToken', token: 'test-token' }, endpointId, cookie: {} } } : {}),
    payload: namespace === 'Alexa.Discovery' ? { scope: { type: 'BearerToken', token: 'test-token' } } : {},
  },
});
