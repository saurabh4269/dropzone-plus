// Simulated yard lights / floodlights (modelled loosely on Alexa-compatible smart switches and floodlights).
// Simulated: there is no real light. Modes: 'off' | 'on'.
// Light only helps the Ring camera (and the drone) see the zone at dusk or night.
// It only changes with an explicit owner "yes", and always restores itself.

export function createYardLights({ onChange } = {}) {
  let mode = 'off';
  let restoreAt = null;
  const log = [];
  const set = (m, why, at = Date.now()) => {
    mode = m;
    log.push({ at: new Date(at).toISOString(), mode: m, why });
    onChange?.({ mode, why });
  };
  return {
    simulated: true,
    get mode() { return mode; },
    get log() { return log.slice(); },
    /** Requires ownerConsent === true. Anything else is refused. */
    turnOn({ ownerConsent, until, at }) {
      if (ownerConsent !== true) return { ok: false, error: 'OWNER_CONSENT_REQUIRED' };
      restoreAt = until ?? null;
      set('on', 'owner approved via Alexa', at);
      return { ok: true, mode };
    },
    restore(why = 'drone departed', at) {
      if (mode !== 'off') set('off', why, at);
      restoreAt = null;
      return { ok: true, mode };
    },
    tick(now = Date.now()) {
      if (restoreAt && now >= restoreAt) this.restore('safety timeout', now);
    },
  };
}
