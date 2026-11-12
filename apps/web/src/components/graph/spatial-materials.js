import {
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
} from "three";

// The existing Three.js runtime is JavaScript. Keep the rendering primitives in
// this small module; application data and interaction state remain in TypeScript.
/** A fine annotation ring, facing the reader at any camera angle. */
function makeRing() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.strokeStyle = "white";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(48, 48, 35, 0, Math.PI * 2);
    context.stroke();
  }
  return new CanvasTexture(canvas);
}

/** @param {string} color @param {number} radius */
export function createSpatialNode(color, radius) {
  const object = new Group();
  const material = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0,
    roughness: 0.95,
    metalness: 0,
    transparent: true,
  });
  const sphere = new Mesh(new SphereGeometry(radius, 24, 16), material);
  const ring = new Sprite(
    new SpriteMaterial({
      map: makeRing(),
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  ring.scale.setScalar(radius * 4.4);
  ring.raycast = () => {};
  ring.visible = false;
  object.add(sphere, ring);

  return {
    object,
    /** @param {{dark: boolean, active: boolean, selected: boolean, muted: boolean}} state */
    update({ dark, active, selected, muted }) {
      material.color.copy(new Color(color).lerp(new Color("#f3eadd"), dark ? 0.18 : 0));
      material.emissiveIntensity = dark ? 0.06 : 0;
      material.opacity = muted ? 0.17 : 1;
      material.depthWrite = !muted;
      sphere.scale.setScalar(selected ? 1.1 : 1);
      ring.visible = active;
      ring.material.opacity = selected ? 0.85 : 0.4;
    },
  };
}

/** @param {boolean} dark */
export function spatialLights(dark) {
  const fill = new HemisphereLight("#f3eadd", "#524440", 1.6);
  const key = new DirectionalLight("#fff4e5", 1.9);
  key.position.set(-160, 250, 400);
  const rim = new DirectionalLight("#d8b28a", dark ? 0.9 : 0.6);
  rim.position.set(180, -80, -250);
  return [new AmbientLight("#ffffff", 0.65), fill, key, rim];
}
