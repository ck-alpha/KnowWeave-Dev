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
/** @param {boolean} ring */
function makeHalo(ring) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    if (ring) {
      context.strokeStyle = "white";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(48, 48, 35, 0, Math.PI * 2);
      context.stroke();
    } else {
      const gradient = context.createRadialGradient(48, 48, 4, 48, 48, 48);
      gradient.addColorStop(0, "rgba(255,255,255,.7)");
      gradient.addColorStop(0.4, "rgba(255,255,255,.2)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 96, 96);
    }
  }
  return new CanvasTexture(canvas);
}

/** @param {string} color @param {number} radius */
export function createSpatialNode(color, radius) {
  const object = new Group();
  const material = new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.1,
    roughness: 0.3,
    metalness: 0.12,
    transparent: true,
  });
  const sphere = new Mesh(new SphereGeometry(radius, 24, 16), material);
  const halo = new Sprite(
    new SpriteMaterial({
      map: makeHalo(false),
      color,
      opacity: 0.2,
      transparent: true,
      depthWrite: false,
    }),
  );
  halo.scale.setScalar(radius * 6);
  // Decorative sprites must not make empty space around a node clickable.
  halo.raycast = () => {};
  const ring = new Sprite(
    new SpriteMaterial({
      map: makeHalo(true),
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    }),
  );
  ring.scale.setScalar(radius * 4.4);
  ring.raycast = () => {};
  ring.visible = false;
  object.add(halo, sphere, ring);

  return {
    object,
    /** @param {{dark: boolean, active: boolean, selected: boolean, muted: boolean}} state */
    update({ dark, active, selected, muted }) {
      material.color.copy(new Color(color).lerp(new Color("#ffffff"), dark ? 0.12 : 0));
      material.emissiveIntensity = muted ? 0.02 : active ? 0.3 : dark ? 0.18 : 0.06;
      material.opacity = muted ? 0.17 : 1;
      material.depthWrite = !muted;
      sphere.scale.setScalar(selected ? 1.1 : 1);
      halo.material.opacity = muted ? 0.025 : active ? 0.5 : dark ? 0.24 : 0.1;
      ring.visible = active;
      ring.material.opacity = selected ? 0.85 : 0.4;
    },
  };
}

/** @param {boolean} dark */
export function spatialLights(dark) {
  const fill = new HemisphereLight(dark ? "#d4e2f0" : "#fff8ee", "#524440", 1.5);
  const key = new DirectionalLight("#fff4e5", 2.8);
  key.position.set(-160, 250, 400);
  const rim = new DirectionalLight("#afcdd4", dark ? 1.8 : 1.1);
  rim.position.set(180, -80, -250);
  return [new AmbientLight("#ffffff", 0.65), fill, key, rim];
}
