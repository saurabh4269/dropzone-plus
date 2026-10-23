// Carrier-facing advisory. Veto-only by construction:
// the only thing it can ever say is HOLD (please wait) or NO_ADVISORY (we have nothing to add).
// It never says "safe", "clear to land" or anything a carrier could treat as authorisation.
// If DropZone+ is down, slow or unsure, the carrier sees NO_ADVISORY and flies exactly as it does today.

import { STATUS, freshen } from './zone.js';

export const ADVICE = Object.freeze({ HOLD: 'HOLD', NO_ADVISORY: 'NO_ADVISORY' });

export const DISCLAIMER =
  'Advisory only. Can request a delay, never authorises a drop. The aircraft\'s own detect-and-avoid remains authoritative. ' +
  'Absence of a HOLD is not a statement that the area is safe.';

const MAX_HOLD_SEC = 180; // a homeowner cannot hold a delivery forever

export function buildAdvisory({ verdict, delivery, now = Date.now(), holdsIssued = 0, maxHolds = 3 }) {
  const v = freshen(verdict, now);
  const out = {
    schema: 'dropzone-plus/advisory@1',
    advice: ADVICE.NO_ADVISORY,
    authorises_drop: false, // always false; present so no client can misread the payload
    reason_codes: [],
    hold_seconds: 0,
    zone_status: v.status,
    observed_at: v.observed_at || null,
    valid_until: v.stale_after || null,
    delivery_ref: delivery?.ref || null,
    disclaimer: DISCLAIMER,
  };
  if (v.status !== STATUS.NOT_CLEAR) return out; // CLEAR and UNKNOWN both mean "nothing to add"
  if (holdsIssued >= maxHolds) {
    out.reason_codes = ['HOLD_BUDGET_EXHAUSTED'];
    return out; // carrier falls back to its own process (abort / ground delivery / land if its sensors agree)
  }
  out.advice = ADVICE.HOLD;
  out.reason_codes = [...new Set(v.reasons.map((r) => r.code))];
  out.hold_seconds = Math.min(60, MAX_HOLD_SEC);
  return out;
}
