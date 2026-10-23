// Optional Amazon Bedrock path (AWS Builder). Disabled unless DZ_BEDROCK=1 and AWS credentials exist.
// Sends one Ring frame to an Amazon Nova model via the Converse API and asks for strict JSON
// detections in the same shape the browser detector produces, so zone.js can score it unchanged.
// NOTE: written against the documented Converse API; not yet exercised against a live account.

const MODEL = process.env.DZ_BEDROCK_MODEL || 'amazon.nova-lite-v1:0';
const REGION = process.env.AWS_REGION || 'us-east-1';

const PROMPT = `You are checking a home camera frame before a drone delivery.
Return ONLY JSON: {"detections":[{"label":"person|dog|cat|car|truck|bicycle|chair|umbrella|sports ball|suitcase|package","score":0..1,"box":[x,y,w,h]}],"notes":"<one short sentence>"}
Boxes are normalised to the frame (0..1, origin top-left). Use labels only; never identify individuals.`;

let sdk;
async function load() {
  if (sdk !== undefined) return sdk;
  try { sdk = await import('@aws-sdk/client-bedrock-runtime'); } catch { sdk = null; }
  return sdk;
}

export async function bedrockAvailable() {
  if (process.env.DZ_BEDROCK !== '1') return { enabled: false, why: 'set DZ_BEDROCK=1 and AWS credentials to enable' };
  const m = await load();
  if (!m) return { enabled: false, why: 'npm install @aws-sdk/client-bedrock-runtime' };
  return { enabled: true, model: MODEL, region: REGION };
}

export async function describeWithBedrock(imageBytes, contentType) {
  const a = await bedrockAvailable();
  if (!a.enabled) return { ok: false, ...a };
  const { BedrockRuntimeClient, ConverseCommand } = sdk;
  const client = new BedrockRuntimeClient({ region: REGION });
  const format = /png/.test(contentType) ? 'png' : 'jpeg';
  const out = await client.send(new ConverseCommand({
    modelId: MODEL,
    messages: [{ role: 'user', content: [{ image: { format, source: { bytes: imageBytes } } }, { text: PROMPT }] }],
    inferenceConfig: { maxTokens: 600, temperature: 0 },
  }));
  const text = out.output?.message?.content?.map((c) => c.text || '').join('') || '';
  const m = text.match(/\{[\s\S]*\}/);
  let parsed = null;
  try { parsed = m ? JSON.parse(m[0]) : null; } catch { /* fall through */ }
  return { ok: Boolean(parsed), model: MODEL, detections: parsed?.detections || [], notes: parsed?.notes || null, raw: parsed ? undefined : text.slice(0, 500), usage: out.usage };
}
