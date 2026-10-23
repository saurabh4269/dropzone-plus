// Simulated Alexa+ add-on: what the household hears and is asked.
// This is NOT a real Alexa integration (no public Alexa+ access exists for this hackathon);
// it produces the utterances and consent prompts an Alexa+ add-on would, and the UI speaks
// them with the browser's speech synthesis.

const NOUN = { pet: 'a pet', person: 'someone', vehicle: 'a vehicle', object: 'something' };

function describe(verdict) {
  const objs = (verdict.objects || []).filter((o) => o.where === 'in' || o.where === 'near');
  if (!objs.length) return null;
  const o = objs[0];
  const what = o.category === 'pet' && o.label ? `a ${o.label}` : NOUN[o.category] || 'something';
  return { what, where: o.where === 'in' ? 'in the drop zone' : 'right next to the drop zone', category: o.category, label: o.label };
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

export function holdNotice({ verdict, holdSeconds }) {
  const d = describe(verdict) || { what: 'something', where: 'in the drop zone' };
  return { speech: `The drone is waiting about ${holdSeconds} seconds because there's ${d.what} ${d.where}. It will try again after that.`, card: { title: 'Drone holding', body: `Waiting ${holdSeconds}s: ${d.what} ${d.where}.` } };
}

export function confirmation(action, ok) {
  if (action === 'petdoor.in_only') return ok ? "Okay. The pet door is now come-in-only. I'll set it back once the drone has gone." : "I couldn't reach the pet door. You may want to call the dog in.";
  return ok ? 'Done.' : 'That didn\'t work.';
}

export function deliveryDone(receipt) {
  if (!receipt) return 'Your drone delivery has arrived.';
  if (receipt.placement === 'in_zone') return 'Your package has been delivered to the drop zone.';
  if (receipt.placement === 'hazard') return `Your package landed near the ${receipt.hazard}. You may want to check on it.`;
  if (receipt.placement === 'outside_zone') return 'Your package landed outside the drop zone. Check the snapshot in the app.';
  return 'Your drone delivery has arrived. I couldn\'t confirm where it landed.';
}
