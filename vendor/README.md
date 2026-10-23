# Vendored third-party files (Apache-2.0)

Bundled so DropZone object detection works offline and without any CDN.

| Path | Source | Licence |
|---|---|---|
| `tfjs/tf-4.22.0.min.js` | https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js (TensorFlow.js) | Apache-2.0 |
| `coco-ssd/coco-ssd-2.2.3.min.js` | https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js | Apache-2.0 |
| `coco-ssd/ssdlite_mobilenet_v2/` | https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/ (model.json + 5 weight shards) | Apache-2.0 |

Licence text: [LICENSE-Apache-2.0.txt](LICENSE-Apache-2.0.txt). Re-download with `scripts/vendor-detector.sh`.
`public/detector.js` loads these first and falls back to the CDN if they are missing.
