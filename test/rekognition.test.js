// Amazon Rekognition path. Pure mapping always runs; the live call runs only with DZ_AWS=1 + AWS credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapLabels, detectLabels, rekognitionAvailable } from '../lib/rekognition.js';
import { evaluateZone } from '../public/core/zone.js';

test('DetectLabels instances map to DropZone detections; pools become hazard hints, not detections', () => {
  const { detections, hazards } = mapLabels([
    { Name: 'Dog', Confidence: 98, Instances: [{ Confidence: 97.8, BoundingBox: { Left: 0.45, Top: 0.55, Width: 0.1, Height: 0.15 } }] },
    { Name: 'Swimming Pool', Confidence: 91, Instances: [] },
    { Name: 'Grass', Confidence: 99, Instances: [] },
    { Name: 'Person', Confidence: 40, Instances: [{ Confidence: 40, BoundingBox: { Left: 0, Top: 0, Width: 0.1, Height: 0.1 } }] },
  ]);
  assert.deepEqual(detections.map((d) => d.label), ['dog']);
  assert.deepEqual(detections[0].box, [0.45, 0.55, 0.1, 0.15]);
  assert.deepEqual(hazards.map((h) => h.label), ['swimming pool']);
  const zone = [[0.4, 0.6], [0.6, 0.6], [0.6, 0.8], [0.4, 0.8]];
  assert.equal(evaluateZone({ detections, zone, observedAt: Date.now() }).status, 'NOT_CLEAR');
});

const live = process.env.DZ_AWS === '1' && (await rekognitionAvailable()).enabled;
test('live: Rekognition DetectLabels on a repo image (DZ_AWS=1 + credentials)', { skip: live ? false : 'set DZ_AWS=1 with AWS credentials to run' }, async () => {
  const r = await detectLabels(readFileSync(new URL('../docs/screenshot-pool.png', import.meta.url)));
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.labels) && r.labels.length > 0);
});
