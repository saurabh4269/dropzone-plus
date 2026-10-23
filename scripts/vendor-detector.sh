#!/usr/bin/env bash
# Re-download the in-browser detector (TensorFlow.js + COCO-SSD lite_mobilenet_v2) into public/vendor/.
set -euo pipefail
cd "$(dirname "$0")/../public/vendor"
curl -fsSL https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js -o tfjs/tf-4.22.0.min.js
curl -fsSL https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js -o coco-ssd/coco-ssd-2.2.3.min.js
M=https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2
curl -fsSL "$M/model.json" -o coco-ssd/ssdlite_mobilenet_v2/model.json
for i in 1 2 3 4 5; do curl -fsSL "$M/group1-shard${i}of5" -o "coco-ssd/ssdlite_mobilenet_v2/group1-shard${i}of5"; done
echo "vendored detector updated"
