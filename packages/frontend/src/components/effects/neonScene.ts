import {
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export interface NeonSceneController {
  dispose(): void;
  setVisible(visible: boolean): void;
  setLight(light: boolean): void;
}

interface NeonSceneOptions {
  light: boolean;
  onFirstFrame(): void;
}

interface PulseTrack {
  curve: CatmullRomCurve3;
  beads: Mesh[];
  speed: number;
  phase: number;
}

/** Three.js scene: actual curved glass tubes, travelling light and selective bloom. */
export function startNeonScene(
  canvas: HTMLCanvasElement,
  options: NeonSceneOptions
): NeonSceneController {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'low-power',
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 30);
  camera.position.z = 10;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.7, 0.34, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const photoMaterial = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.035,
    depthWrite: false,
  });
  const photoGeometry = new PlaneGeometry(1, 1);
  const photo = new Mesh(photoGeometry, photoMaterial);
  photo.position.z = -3;
  scene.add(photo);

  const tubes = new Group();
  scene.add(tubes);
  const loader = new TextureLoader();
  let photoTexture: Texture | undefined;
  let photoVariant = '';
  let disposed = false;
  let light = options.light;
  let firstFrame = false;
  let lastFrame = -Infinity;
  let width = 1;
  let height = 1;
  let pulseTracks: PulseTrack[] = [];
  let layoutResources: Array<{ dispose(): void }> = [];

  const loadPhoto = (mobile: boolean) => {
    const variant = mobile ? 'mobile' : 'wide';
    if (variant === photoVariant) return;
    photoVariant = variant;
    const previous = photoTexture;
    const next = loader.load(`/backgrounds/neon-glow-${variant}.webp`, () => {
      if (disposed || photoTexture !== next) return;
      next.colorSpace = SRGBColorSpace;
      photoMaterial.needsUpdate = true;
    });
    photoTexture = next;
    next.colorSpace = SRGBColorSpace;
    photoMaterial.map = next;
    photoMaterial.needsUpdate = true;
    previous?.dispose();
  };

  const rebuildTubes = () => {
    tubes.clear();
    for (const resource of layoutResources) resource.dispose();
    layoutResources = [];
    pulseTracks = [];

    const halfWidth = (camera.right - camera.left) / 2;
    const mobile = width <= 768;
    const edgeScale = mobile ? 1.3 : 1.2;
    const definitions: Array<{ color: number; phase: number; points: Array<[number, number]> }> = [
      {
        color: 0x00e6f5,
        phase: 0.04,
        points: [
          [-1.1, 5.8],
          [-0.83, 3.2],
          [-0.62, 0.9],
          [-0.94, -1.8],
          [-0.65, -5.8],
        ],
      },
      {
        color: 0xe833db,
        phase: 0.52,
        points: [
          [0.65, 5.8],
          [0.9, 3.0],
          [0.63, 0.2],
          [0.84, -2.6],
          [1.08, -5.8],
        ],
      },
    ];
    if (!mobile) {
      definitions.push({
        color: 0x7962fa,
        phase: 0.3,
        points: [
          [-1.15, -4.4],
          [-0.5, -4.15],
          [0.05, -5.1],
          [0.7, -4.45],
          [1.15, -4.75],
        ],
      });
    }

    const beadGeometry = new SphereGeometry(0.052, 8, 6);
    const beadMaterial = new MeshBasicMaterial({
      color: light ? 0x65448f : new Color().setRGB(3, 2.4, 3),
      toneMapped: false,
      depthTest: false,
    });
    layoutResources.push(beadGeometry, beadMaterial);

    definitions.forEach(({ color, phase, points }, index) => {
      const curve = new CatmullRomCurve3(
        points.map(([x, y]) => new Vector3(x * halfWidth * edgeScale, y, 0)),
        false,
        'catmullrom',
        0.4
      );
      const haloOuter = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: light ? 0.055 : 0.025,
        blending: light ? undefined : AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const haloInner = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: light ? 0.13 : 0.085,
        blending: light ? undefined : AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const glass = new MeshBasicMaterial({
        color: light ? 0x39475b : 0x182e49,
        transparent: true,
        opacity: light ? 0.48 : 0.7,
        depthWrite: false,
        depthTest: false,
      });
      const colorMaterial = new MeshBasicMaterial({
        color: new Color(color).multiplyScalar(light ? 0.72 : 0.9),
        toneMapped: false,
        depthWrite: false,
        depthTest: false,
      });
      const coreColor = light
        ? new Color(color).multiplyScalar(0.72)
        : new Color(color).lerp(new Color(0xffffff), 0.55).multiplyScalar(1.55);
      const core = new MeshBasicMaterial({
        color: coreColor,
        toneMapped: false,
        depthWrite: false,
        depthTest: false,
      });
      layoutResources.push(haloOuter, haloInner, glass, colorMaterial, core);

      for (const [order, radius, material] of [
        [1, 0.18, haloOuter],
        [2, 0.105, haloInner],
        [3, 0.062, glass],
        [4, 0.038, colorMaterial],
        [5, 0.015, core],
      ] as const) {
        const geometry = new TubeGeometry(curve, mobile ? 80 : 112, radius, 6, false);
        layoutResources.push(geometry);
        const tube = new Mesh(geometry, material);
        tube.renderOrder = order;
        tubes.add(tube);
      }

      const beads = Array.from({ length: 3 }, () => {
        const bead = new Mesh(beadGeometry, beadMaterial);
        tubes.add(bead);
        return bead;
      });
      pulseTracks.push({ curve, beads, speed: 0.075 + index * 0.017, phase });
    });
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    if (width === nextWidth && height === nextHeight) return;
    width = nextWidth;
    height = nextHeight;
    const mobile = width <= 768;
    const maxRatio = mobile ? 1 : 1.25;
    const ratio = Math.max(
      0.5,
      Math.min(window.devicePixelRatio || 1, maxRatio, Math.sqrt(1_400_000 / (width * height)))
    );
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    const halfWidth = (5 * width) / height;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.updateProjectionMatrix();
    photo.scale.set(halfWidth * 2, 10, 1);
    loadPhoto(mobile);
    rebuildTubes();
  };

  const renderFrame = (now: number) => {
    if (now - lastFrame < (width <= 768 ? 50 : 42)) return;
    lastFrame = now;
    const seconds = now / 1000;
    tubes.position.x = Math.sin(seconds * 0.23) * 0.09;
    tubes.rotation.z = Math.sin(seconds * 0.17) * 0.006;
    photo.position.x = Math.sin(seconds * 0.1) * 0.035;
    for (const track of pulseTracks) {
      track.beads.forEach((bead, index) => {
        const progress = (seconds * track.speed + track.phase - index * 0.018 + 1) % 1;
        bead.position.copy(track.curve.getPointAt(progress));
        bead.scale.setScalar(1 - index * 0.24);
      });
    }
    composer.render();
    if (!firstFrame) {
      firstFrame = true;
      options.onFirstFrame();
    }
  };

  const setVisible = (nextVisible: boolean) => {
    if (disposed) return;
    lastFrame = -Infinity;
    renderer.setAnimationLoop(nextVisible ? renderFrame : null);
  };

  const setLight = (nextLight: boolean) => {
    if (disposed || nextLight === light) return;
    light = nextLight;
    scene.background = new Color(light ? 0xd5e4ed : 0x091323);
    photoMaterial.opacity = light ? 0.13 : 0.035;
    bloom.strength = light ? 0.24 : 0.7;
    bloom.threshold = light ? 0.78 : 0.72;
    rebuildTubes();
  };

  scene.background = new Color(light ? 0xd5e4ed : 0x091323);
  photoMaterial.opacity = light ? 0.13 : 0.035;
  bloom.strength = light ? 0.24 : 0.7;
  bloom.threshold = light ? 0.78 : 0.72;
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  setVisible(true);

  return {
    setVisible,
    setLight,
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      tubes.clear();
      for (const resource of layoutResources) resource.dispose();
      photoTexture?.dispose();
      photoGeometry.dispose();
      photoMaterial.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
