// AWS runtime path: Amazon Rekognition DetectLabels on Ring frames (opt-in: DZ_AWS=1).
// Uses AWS SDK v3 with the default credential chain (env vars, ~/.aws profile, SSO/login, instance role).
// Output matches the browser detector's shape ({label, score, box:[x,y,w,h]} normalised to the image),
// so public/core/zone.js scores it unchanged. Scene-level labels with no boxes (Pool, Water) are returned
// separately as hazard hints: DropZone+ never infers "safe" from them, it only warns.

const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

// Rekognition label -> DropZone+ label (labels only, never identities)
const MAP = {
  Person: 'person', Human: 'person', Child: 'person', Adult: 'person',
  Dog: 'dog', Cat: 'cat', Pet: 'dog', Animal: 'dog', Bird: 'bird', Horse: 'horse',
  Car: 'car', Truck: 'truck', Vehicle: 'car', Bicycle: 'bicycle', Motorcycle: 'motorcycle',
  Chair: 'chair', Bench: 'bench', Umbrella: 'umbrella', 'Patio Umbrella': 'umbrella', Box: 'suitcase', Cardboard: 'suitcase', Package: 'suitcase',
  'Potted Plant': 'potted plant', Plant: 'potted plant', Ball: 'sports ball', Trampoline: 'bench',
};
const HAZARD_HINTS = ['Pool', 'Swimming Pool', 'Water', 'Pond', 'Hot Tub', 'Fountain', 'Stairs', 'Staircase'];

let sdk;
async function load() {
  if (sdk !== undefined) return sdk;
  try { sdk = await import('@aws-sdk/client-rekognition'); } catch { sdk = null; }
  return sdk;
}

export async function rekognitionAvailable() {
  if (process.env.DZ_AWS !== '1') return { enabled: false, why: 'set DZ_AWS=1 (and AWS credentials) to use Amazon Rekognition' };
  if (!(await load())) return { enabled: false, why: 'npm install (optional dependency @aws-sdk/client-rekognition)' };
  return { enabled: true, service: 'Amazon Rekognition DetectLabels', region: REGION };
}

/** Pure mapping, exported for tests. */
export function mapLabels(labels = [], { minConfidence = 50 } = {}) {
  const detections = [];
  const hazards = [];
  for (const l of labels) {
    if (HAZARD_HINTS.includes(l.Name) && l.Confidence >= minConfidence) hazards.push({ label: l.Name.toLowerCase(), score: +(l.Confidence / 100).toFixed(3) });
    const mapped = MAP[l.Name];
    if (!mapped) continue;
    for (const inst of l.Instances || []) {
      const b = inst.BoundingBox;
      if (!b || (inst.Confidence ?? l.Confidence) < minConfidence) continue;
      detections.push({ label: mapped, score: +((inst.Confidence ?? l.Confidence) / 100).toFixed(3), box: [b.Left, b.Top, b.Width, b.Height], source_label: l.Name });
    }
  }
  return { detections, hazards };
}

/** Run DetectLabels on JPEG/PNG bytes. */
export async function detectLabels(imageBytes, { maxLabels = 40, minConfidence = 50, client } = {}) {
  const a = await rekognitionAvailable();
  if (!a.enabled && !client) return { ok: false, ...a };
  const { RekognitionClient, DetectLabelsCommand } = sdk || (await load());
  const c = client || new RekognitionClient({ region: REGION });
  const t0 = Date.now();
  const out = await c.send(new DetectLabelsCommand({ Image: { Bytes: imageBytes }, MaxLabels: maxLabels, MinConfidence: minConfidence }));
  const { detections, hazards } = mapLabels(out.Labels, { minConfidence });
  return { ok: true, service: 'rekognition:DetectLabels', region: REGION, ms: Date.now() - t0, detections, hazards, labels: (out.Labels || []).map((l) => `${l.Name} ${Math.round(l.Confidence)}%`) };
}
