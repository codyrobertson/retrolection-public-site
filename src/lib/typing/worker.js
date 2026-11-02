// One scene per worker. Requests are answered in order; layers come back as ImageBitmaps.
import GK from './gk.js';
import { createScene } from './scene.js';

let scene = null;

const bitmap = async ({ data, x, y, w, h }) => ({ x, y, w, h, bitmap: await createImageBitmap(new ImageData(data, w, h)) });

const handlers = {
  init({ params }) {
    scene = createScene(GK, params);
    return { layout: scene.layout, keys: scene.keys, mouse: { box: scene.mouse.box, offset: scene.mouse.offset } };
  },
  schedule: ({ text, live }) => scene.schedule(text, { live }),
  keyboard: ({ boil }) => bitmap(scene.keyboardLayer(boil)),
  patch: ({ id, boil }) => bitmap(scene.keyPatch(id, boil)),
  hand: ({ side, spec, boil }) => bitmap(scene.handLayer(side, spec, boil)),
  mouse: ({ b, w, boil }) => bitmap(scene.mouse.layer(b, w, boil)),
  metrics: () => scene.metrics(),
  check: ({ text }) => { const s = scene.schedule(text); return scene.checkAll([...s.frames, ...s.exit]); },
};

self.onmessage = async ({ data: { seq, type, req } }) => {
  try {
    const out = await handlers[type](req);
    self.postMessage({ seq, out }, out && out.bitmap ? [out.bitmap] : []);
  } catch (err) {
    self.postMessage({ seq, error: String((err && err.stack) || err) });
  }
};
