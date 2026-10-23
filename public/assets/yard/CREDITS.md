# Replay yard imagery

All files in this folder were generated for DropZone with an AI image generator (October 2026) and
post-processed on the build box (resize, chroma-key cut-outs, brightness). No stock photos, no real
people, no real Ring product UI or logos. Licensed with the rest of the repo (MIT).

| File | What it is |
| --- | --- |
| day.jpg | Backyard from a high, wide-angle camera, daytime |
| dusk-dark.jpg | Same angle, dusk, all lights off (too dark to read) |
| dusk-lit.jpg | Same angle, dusk, yard lights on |
| dog.png, kid.png, package.png, drone.png | Cut-out sprites placed by the replay script (the child is seen from behind, not a real person) |

Overlay coordinates that depend on this framing: `DEFAULT_ZONE`, the pool hazard and the actor paths in
`scenarios.js`, and the demo actors and default zone in `app/main.js`.
