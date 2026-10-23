// Simulated Alexa+ add-on: what the household hears and is asked.
// This is NOT a real Alexa integration (no public Alexa+ access exists for this hackathon);
// it produces the utterances and consent prompts an Alexa+ add-on would, and the UI speaks
// them with the browser's speech synthesis.

const NOUN = { pet: 'a pet', person: 'someone', vehicle: 'a vehicle', object: 'something' };

function describe(verdict) {
  const order = { in: 0, over: 1, near: 2 };
  const objs = (verdict.objects || []).filter((o) => o.where in order).sort((a, b) => order[a.where] - order[b.where]);
  if (!objs.length) return null;
  const o = objs[0];
  const what = o.category === 'pet' && o.label ? `a ${o.label}` : NOUN[o.category] || 'something';
  return { what, where: o.where === 'near' ? 'right next to the drop zone' : 'in the drop zone', category: o.category, label: o.label };
}

/**
 * @returns {{speech:string, card:{title:string, body:string}, prompt?:{id:string, question:string, action:string}}|null}
 */
export function headsUp({ verdict, etaMin, household = {}, petDoor }) {
  const mins = Math.max(1, Math.round(etaMin));
  if (verdict.status === 'UNKNOWN') {
    return {
      speech: `Your drone delivery is about ${mins} minute${mins === 1 ? '' : 's'} away. I can't see the drop zone right now, so please take a quick look at the yard.`,
      card: { title: `Drone in ${mins} min`, body: 'Drop zone: UNKNOWN. Camera view unavailable.' },
    };
  }
  if (verdict.status === 'CLEAR') {
    return {
      speech: `Your drone delivery is about ${mins} minute${mins === 1 ? '' : 's'} away. The drop zone looks clear right now. Please keep it that way.`,
      card: { title: `Drone in ${mins} min`, body: 'Drop zone looks clear.' },
    };
  }
  const d = describe(verdict) || { what: 'something', where: 'in the drop zone', category: 'object' };
  let speech = `Heads up: your drone delivery is about ${mins} minute${mins === 1 ? '' : 's'} away, and there's ${d.what} ${d.where}.`;
  let prompt;
  if (d.category === 'pet' && petDoor && household.hasPetDoor) {
    speech += ` Want me to set the pet door to come-in-only until the drone has left?`;
    prompt = { id: 'petdoor-in-only', question: 'Set pet door to come-in-only until the drone leaves?', action: 'petdoor.in_only' };
  } else if (d.category === 'person') {
    speech += ' The drone may hold until the area is clear.';
  } else if (d.category === 'object') {
    speech += ' Could someone move it?';
  }
  return { speech, card: { title: `Drone in ${mins} min`, body: `Drop zone NOT CLEAR: ${d.what} ${d.where}.` }, prompt };
}

/**
 * Device offers at the start of a delivery window (simulated devices, owner consent required).
 * Lights: only when the household reports low light and has yard lights that are off.
 * Sprinkler: only when a scheduled run falls inside the drop window.
 */
export function deviceOffers({ household = {}, lightsOff = true, sprinklerRunsAt = null, now, windowEnd }) {
  const out = [];
  if (household.hasYardLights && household.lowLight && lightsOff) {
    out.push({ speech: "It's getting dark, and the camera needs light to check the drop zone. Want me to turn on the yard lights until the drone has left?",
      prompt: { id: 'lights-on', question: 'Turn on the yard lights until the drone leaves?', action: 'lights.on' } });
  }
  if (household.hasSprinkler && Number.isFinite(sprinklerRunsAt) && sprinklerRunsAt >= now && sprinklerRunsAt <= windowEnd) {
    const mins = Math.max(1, Math.round((sprinklerRunsAt - now) / 60000));
    out.push({ speech: `Your sprinklers are scheduled to run in about ${mins} minute${mins === 1 ? '' : 's'}, during the drop window. Want me to pause them until the drone has left?`,
      prompt: { id: 'sprinkler-pause', question: 'Pause the sprinklers until the drone leaves?', action: 'sprinkler.pause' } });
  }
  return out;
}

export function holdNotice({ verdict, holdSeconds }) {
  const d = describe(verdict) || { what: 'something', where: 'in the drop zone' };
  return { speech: `The drone is waiting about ${holdSeconds} seconds because there's ${d.what} ${d.where}. It will try again after that.`, card: { title: 'Drone holding', body: `Waiting ${holdSeconds}s: ${d.what} ${d.where}.` } };
}

export function confirmation(action, ok) {
  if (action === 'petdoor.in_only') return ok ? "Okay. The pet door is now come-in-only. I'll set it back once the drone has gone." : "I couldn't reach the pet door. You may want to call the dog in.";
  if (action === 'lights.on') return ok ? "Okay. The yard lights are on so the camera can see the drop zone. I'll turn them off once the drone has gone." : "I couldn't reach the yard lights. The camera may not be able to check the zone in this light.";
  if (action === 'sprinkler.pause') return ok ? "Okay. I've paused the sprinklers for this delivery. The schedule goes back to normal once the drone has gone." : "I couldn't reach the sprinkler controller. The next run may start during the drop.";
  return ok ? 'Done.' : 'That didn\'t work.';
}

export function deliveryDone(receipt) {
  if (!receipt) return 'Your drone delivery has arrived.';
  if (receipt.placement === 'in_zone') return 'Your package has been delivered to the drop zone.';
  if (receipt.placement === 'hazard') return `Your package landed near the ${receipt.hazard}. You may want to check on it.`;
  if (receipt.placement === 'outside_zone') return 'Your package landed outside the drop zone. Check the snapshot in the app.';
  return 'Your drone delivery has arrived. I couldn\'t confirm where it landed.';
}
