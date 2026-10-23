// Simulated sprinkler / irrigation controller (modelled loosely on Alexa-compatible controllers such as Rachio).
// Simulated: there is no real valve. Modes: 'scheduled' | 'paused' | 'running'.
// A scheduled run during the drop window would soak the zone (and the package, and anyone in it).
// Pausing only happens with an explicit owner "yes", and the schedule always restores itself.

export function createSprinkler({ onChange, nextRunAt = null, runSeconds = 120 } = {}) {
  let mode = 'scheduled';
  let restoreAt = null;
  let runAt = nextRunAt;
  let runEndsAt = null;
  const log = [];
  const set = (m, why, at = Date.now()) => {
    mode = m;
    log.push({ at: new Date(at).toISOString(), mode: m, why });
    onChange?.({ mode, why });
  };
  return {
    simulated: true,
    get mode() { return mode; },
    get nextRunAt() { return runAt; },
    get log() { return log.slice(); },
    /** Requires ownerConsent === true. Anything else is refused. Skips the next run only. */
    pause({ ownerConsent, until, at }) {
      if (ownerConsent !== true) return { ok: false, error: 'OWNER_CONSENT_REQUIRED' };
      restoreAt = until ?? null;
      set('paused', 'owner approved via Alexa (simulated)', at);
      return { ok: true, mode };
    },
    restore(why = 'drone departed', at) {
      if (mode === 'paused') { runAt = null; set('scheduled', why, at); } // the skipped run stays skipped
      restoreAt = null;
      return { ok: true, mode };
    },
    tick(now = Date.now()) {
      if (mode === 'paused' && restoreAt && now >= restoreAt) this.restore('safety timeout', now);
      if (mode === 'scheduled' && runAt && now >= runAt) { runEndsAt = runAt + runSeconds * 1000; runAt = null; set('running', 'scheduled run (simulated)', now); }
      if (mode === 'running' && now >= runEndsAt) set('scheduled', 'scheduled run finished (simulated)', now);
    },
  };
}
