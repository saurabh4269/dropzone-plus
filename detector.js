// Real object detection in the browser: TensorFlow.js + COCO-SSD (lite_mobilenet_v2), Apache-2.0.
// Loads the copies vendored in public/vendor/ (no network needed); falls back to the jsDelivr CDN
// only if the vendored files are missing. Frames never leave the browser.

const LOCAL = {
  tf: new URL('./vendor/tfjs/tf-4.22.0.min.js', import.meta.url).href,
  coco: new URL('./vendor/coco-ssd/coco-ssd-2.2.3.min.js', import.meta.url).href,
  model: new URL('./vendor/coco-ssd/ssdlite_mobilenet_v2/model.json', import.meta.url).href,
};
const CDN = {
  tf: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  coco: 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  model: undefined, // coco-ssd's default (storage.googleapis.com)
};

let modelP;
export let detectorSource = null;

function script(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => { s.remove(); bad(new Error('failed to load ' + src)); }; document.head.append(s); });
}

async function loadFrom(src) {
  if (!window.tf) await script(src.tf);
  if (!window.cocoSsd) await script(src.coco);
  return window.cocoSsd.load({ base: 'lite_mobilenet_v2', ...(src.model ? { modelUrl: src.model } : {}) });
}

export function loadDetector() {
  if (!modelP) {
    modelP = loadFrom(LOCAL).then((m) => { detectorSource = 'vendored'; return m; })
      .catch(() => loadFrom(CDN).then((m) => { detectorSource = 'cdn'; return m; }))
      .catch((e) => { modelP = null; throw e; }); // let a later call retry
  }
  return modelP;
}

export async function detect(el) {
  const model = await loadDetector();
  return model.detect(el, 20, 0.3);
}
