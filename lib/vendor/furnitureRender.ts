import { ACESFilmicToneMapping, Box3, Color, DirectionalLight, type Group, Mesh, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/** A studio render of the model from the front three-quarter view (the reference GPT Sol turns into photos, and the
 * listing's thumbnail). */
export async function renderFurniture(group: Group, side = 1024): Promise<Blob> {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(side, side, false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    const scene = new Scene();
    scene.background = new Color("#f3f1ee");
    scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    const box = new Box3().setFromObject(group);
    // A soft key light from the front left with a soft shadow on the floor: grounded, like a studio photo.
    const sun = new DirectionalLight("#fff6ea", 1.6);
    sun.position.set(-2, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    const floor = new Mesh(new PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new ShadowMaterial({ opacity: 0.18 }));
    floor.position.y = box.min.y;
    floor.receiveShadow = true;
    scene.add(sun, floor, group.clone());
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const camera = new PerspectiveCamera(30, 1, 0.01, 100);
    camera.position.copy(center).add(new Vector3(0.55, 0.4, 1).normalize().multiplyScalar(size * 1.9));
    camera.lookAt(center);
    renderer.render(scene, camera);
    return await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not render the model."))), "image/png"));
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function furnitureGlb(group: Group): Promise<Blob> {
  const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  return new Blob([glb], { type: "model/gltf-binary" });
}
