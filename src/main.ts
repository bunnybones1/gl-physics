import { PerspectiveCamera, Scene, WebGLRenderer } from "three";
import FPSCounter from "./helpers/FPSCounter";
import GLSimPoints from "./GLSimPoints";

const view3d = document.createElement("div");
document.body.appendChild(view3d);
const renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });

for (const v of ["-moz-crisp-edges", "-webkit-crisp-edges", "crisp-edges", "pixelated"]) {
  renderer.domElement.style.setProperty("image-rendering", v);
}

renderer.autoClear = false;
renderer.setSize(view3d.clientWidth || window.innerWidth, window.innerHeight);
// renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// renderer.setPixelRatio(1);
view3d.appendChild(renderer.domElement);

const scene = new Scene();

scene.matrixAutoUpdate = false;
scene.matrixWorldAutoUpdate = false;

const camera = new PerspectiveCamera(
  75,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 5);

// Resize handling
function resize() {
  const width = view3d.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

const glp = new GLSimPoints();

scene.add(glp.visuals);
glp.visuals.updateMatrixWorld();

scene.add(camera);

scene.updateMatrix();
const fpsCounter = new FPSCounter();

let frame = 0;
// Render loop
function loop() {
  frame++;
  fpsCounter.update();

  camera.updateMatrixWorld(true);

  if (frame % 1 === 0) {
    glp.update(renderer);
  }

  renderer.clearColor();
  renderer.render(scene, camera);
  renderer.clearDepth();
  requestAnimationFrame(loop);
}
resize();
loop();
