// Real object detection in the browser: TensorFlow.js COCO-SSD (Apache-2.0), loaded on first use.
// Runs on Ring snapshots, Ring live frames, or a photo you upload. No frames leave the browser.

const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';

let modelP;

function script(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => bad(new Error('failed to load ' + src)); document.head.append(s); });
}

export function loadDetector() {
  if (!modelP) modelP = (async () => { await script(TFJS); await script(COCO); return window.cocoSsd.load({ base: 'lite_mobilenet_v2' }); })();
  return modelP;
}

export async function detect(el) {
  const model = await loadDetector();
  return model.detect(el, 20, 0.3);
}
