// Builds Alexa request envelopes (shape per the Alexa Skills Kit request JSON reference).
export function req(type, intent, attrs = {}, isNew = false) {
  return {
    version: '1.0',
    session: { new: isNew, sessionId: 'amzn1.echo-api.session.test', application: { applicationId: 'amzn1.ask.skill.test' }, attributes: attrs, user: { userId: 'amzn1.ask.account.test' } },
    context: { System: { application: { applicationId: 'amzn1.ask.skill.test' }, user: { userId: 'amzn1.ask.account.test' }, device: { deviceId: 'test', supportedInterfaces: {} }, apiEndpoint: 'https://api.amazonalexa.com' } },
    request: { type, requestId: 'amzn1.echo-api.request.test', timestamp: new Date().toISOString(), locale: 'en-US', ...(intent ? { intent: { name: intent, confirmationStatus: 'NONE', slots: {} } } : {}) },
  };
}
