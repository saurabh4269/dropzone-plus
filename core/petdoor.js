// Simulated smart pet door (modelled loosely on Alexa-compatible doors such as Wayzn / Pawport).
// Simulated: there is no real door. Modes: 'normal' | 'in_only' | 'locked'.
// It only changes with an explicit owner "yes", and always restores itself.

export function createPetDoor({ onChange } = {}) {
  let mode = 'normal';
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
    setInOnly({ ownerConsent, until, at }) {
      if (ownerConsent !== true) return { ok: false, error: 'OWNER_CONSENT_REQUIRED' };
      restoreAt = until ?? null;
      set('in_only', 'owner approved via Alexa', at);
      return { ok: true, mode };
    },
    restore(why = 'drone departed', at) {
      if (mode !== 'normal') set('normal', why, at);
      restoreAt = null;
      return { ok: true, mode };
    },
    tick(now = Date.now()) {
      if (restoreAt && now >= restoreAt) this.restore('safety timeout', now);
    },
  };
}
