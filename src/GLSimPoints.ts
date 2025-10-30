import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  NormalBufferAttributes,
  Object3D,
  Object3DEventMap,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RGBAFormat,
  Scene,
  ShaderChunk,
  Texture,
  TextureLoader,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { physicsSettings } from "./physicsSettings";

// Extend ImportMeta interface to include Vite's hot reload functionality
declare global {
  interface ImportMeta {
    hot?: {
      accept(dep: string, callback: (mod: unknown) => void): void;
    };
  }
}

const flipY = false;

const mapName = "map";

const gravityColor = new Color(physicsSettings.wind, physicsSettings.gravity, 0);
const initialVel = 0.005;

export default class GLSimPoints {
  visuals: Object3D;
  pointsGeom: BufferGeometry<NormalBufferAttributes>;
  scene: Scene = new Scene();
  pointScene: Scene = new Scene();
  pointScene2: Scene = new Scene();
  camera: OrthographicCamera = new OrthographicCamera(0, 1, 0, 1, 1, -1);
  pointCamera: OrthographicCamera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
  positionRT: WebGLRenderTarget<Texture>;
  positionRTBackBuffer: WebGLRenderTarget<Texture>;
  velocityFrictionMat: MeshBasicMaterial;
  plane: Mesh<PlaneGeometry, MeshBasicMaterial, Object3DEventMap>;
  initPositionMat: MeshBasicMaterial;
  velocityIntegrationMat: MeshBasicMaterial;
  velocityRT: WebGLRenderTarget<Texture>;
  initVelocityMat: MeshBasicMaterial;
  boundaryLoopMat: MeshBasicMaterial;
  pointsMat: PointsMaterial;
  ingoingPositionTextureUniform: { value: Texture };
  pressureRT: WebGLRenderTarget<Texture>;
  pressurePointsMat: PointsMaterial;
  pressureVectorRT: WebGLRenderTarget<Texture>;
  pressureVectorRemappedRT: WebGLRenderTarget<Texture>;
  pressureVectorMat: MeshBasicMaterial;
  dataPoints: Points;
  obstacleMat: MeshBasicMaterial;
  pressureSoftRT: WebGLRenderTarget<Texture>;
  pressureSoftMat: MeshBasicMaterial;
  pressureVectorToVelocityIntegrationMat: MeshBasicMaterial;
  // Phase 1: elastic connection textures (one connection per texture)
  elasticConnRT0: WebGLRenderTarget<Texture>;
  elasticConnRT1: WebGLRenderTarget<Texture>;
  elasticConnRT2: WebGLRenderTarget<Texture>;
  elasticConnRT3: WebGLRenderTarget<Texture>;
  // Phase 2: static DataTextures holding the initialized elastic connections
  elasticConnTex0!: DataTexture;
  elasticConnTex1!: DataTexture;
  elasticConnTex2!: DataTexture;
  elasticConnTex3!: DataTexture;
  // Phase 3: direct-add elastic forces into velocity
  elasticForcesToVelocityMat!: MeshBasicMaterial;

  constructor() {
    const pointsGeom = new BufferGeometry();
    this.pointsGeom = pointsGeom;
    const w = 256;
    const h = 256;
    const count = w * h;

    // apply current physics settings to runtime materials/uniforms
    this.applyPhysicsSettings(physicsSettings);
    // Vite HMR: accept updates to physicsSettings without full reload
    if (import.meta && import.meta.hot) {
      import.meta.hot.accept("./physicsSettings.ts", (mod: unknown) => {
        const typedMod = mod as { physicsSettings?: typeof physicsSettings } | undefined;
        const next = typedMod?.physicsSettings;
        if (next) this.applyPhysicsSettings(next);
      });
    }

    const TEXEL_SIZE = (1.0 / w).toFixed(6);

    const obstacleDensityTextureArr = new Uint8Array(count * 4);
    for (let iy = 0; iy < h; iy++) {
      const v = Math.min(1.0, Math.max(0.0, (iy / h - 0.1) * -10)) * 0.0;
      // const v = Math.min(1.0, Math.max(0.0, (iy / h - 0.1) * -10)) * 256.0;
      for (let ix = 0; ix < w; ix++) {
        const i = ix + w * iy;
        const i4 = i * 4;
        // const v = iy > h * 0.7 ? 10.0 : 0.0
        obstacleDensityTextureArr[i4] = v; // x
        // obstacleTextureArr[i4] = Math.random() // x
        obstacleDensityTextureArr[i4 + 1] = v; // y
        // obstacleTextureArr[i4 + 1] = Math.random() // y
        obstacleDensityTextureArr[i4 + 2] = v; // z
        obstacleDensityTextureArr[i4 + 3] = 255; // w
      }
    }
    const obstacleTexture = new DataTexture(
      obstacleDensityTextureArr,
      w,
      h,
      RGBAFormat,
      UnsignedByteType
    );
    obstacleTexture.flipY = flipY;
    obstacleTexture.needsUpdate = true;

    const obstacleMat = new MeshBasicMaterial({
      map: obstacleTexture,
      // side: DoubleSide,
      blending: AdditiveBlending,
      transparent: true,
      opacity: 5,
    });
    this.obstacleMat = obstacleMat;

    //load png texture
    const obstacleTextureLoader = new TextureLoader();
    obstacleTextureLoader.load(`textures/${mapName}.png`, (data) => {
      data.flipY = false;
      obstacleMat.map = data;
    });

    const offsetX = 0.1;
    const offsetY = 0.5;
    const posTextureArr = new Float32Array(count * 4);
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const i = ix + w * iy;
        const i4 = i * 4;
        posTextureArr[i4] = (ix / w - 0.5) * 0.1 + offsetX; // x
        // posTextureArr[i4] = Math.random() // x
        posTextureArr[i4 + 1] = (iy / h - 0.5) * 0.1 + offsetY; // y
        // posTextureArr[i4 + 1] = Math.random() // y
        posTextureArr[i4 + 2] = 0; // z
        posTextureArr[i4 + 3] = 1; // w
      }
    }
    const initPositionTexture = new DataTexture(posTextureArr, w, h, RGBAFormat, FloatType);
    initPositionTexture.flipY = flipY;
    initPositionTexture.needsUpdate = true;
    const velTextureArr = new Float32Array(count * 4);
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const i = ix + w * iy;
        const i4 = i * 4;
        const a = Math.random() * Math.PI * 2;
        const vel = initialVel * Math.sqrt(Math.random());
        velTextureArr[i4] = vel * Math.sin(a); // x
        velTextureArr[i4 + 1] = vel * Math.cos(a); // y
        velTextureArr[i4 + 2] = 0; // z
        // velTextureArr[i4 + 2] = 0.01 * (Math.random() - 0.5) // z
        velTextureArr[i4 + 3] = 1; // w
      }
    }
    const initVelocityTexture = new DataTexture(velTextureArr, w, h, RGBAFormat, FloatType);
    initVelocityTexture.needsUpdate = true;

    const velocityRT = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    velocityRT.texture.flipY = flipY;
    this.velocityRT = velocityRT;

    const positionRT = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    positionRT.texture.flipY = flipY;
    this.positionRT = positionRT;

    const positionRTBackBuffer = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    this.positionRTBackBuffer = positionRTBackBuffer;

    const pressureRT = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    pressureRT.texture.flipY = flipY;
    this.pressureRT = pressureRT;

    const pressureSoftRT = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    pressureSoftRT.texture.flipY = flipY;
    this.pressureSoftRT = pressureSoftRT;

    const pressureVectorRT = new WebGLRenderTarget(w, h, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    pressureVectorRT.texture.flipY = flipY;
    this.pressureVectorRT = pressureVectorRT;

    const pressureVectorRemappedRT = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    pressureVectorRemappedRT.texture.flipY = flipY;
    this.pressureVectorRemappedRT = pressureVectorRemappedRT;

    // Phase 1: allocate elastic connection textures (RGBA Float32)
    const elasticConnRT0 = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    elasticConnRT0.texture.flipY = flipY;
    const elasticConnRT1 = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    elasticConnRT1.texture.flipY = flipY;
    const elasticConnRT2 = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    elasticConnRT2.texture.flipY = flipY;
    const elasticConnRT3 = new WebGLRenderTarget(w, h, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      format: RGBAFormat,
      type: FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: NoColorSpace,
    });
    elasticConnRT3.texture.flipY = flipY;

    this.elasticConnRT0 = elasticConnRT0;
    this.elasticConnRT1 = elasticConnRT1;
    this.elasticConnRT2 = elasticConnRT2;
    this.elasticConnRT3 = elasticConnRT3;

    // Phase 2: Initialize elastic connection DataTextures with cardinal neighbors
    // Encoding per texel: R,G = target UV; B = desired length (one texel); A = elasticity
    const conn0Arr = new Float32Array(count * 4);
    const conn1Arr = new Float32Array(count * 4);
    const conn2Arr = new Float32Array(count * 4);
    const conn3Arr = new Float32Array(count * 4);
    const oneTexelX = 0.5 / w;
    const oneTexelY = 0.5 / h;
    const clusterSize = 8;
    const elasticityA = physicsSettings.elasticityDefault ?? 1.0;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const i = ix + w * iy;
        const i4 = i * 4;

        const selfU = (ix + 0.5) / w;
        const selfV = (iy + 0.5) / h;

        const isFirstCol = ix % clusterSize === 0;
        const isLastCol = ix % clusterSize === clusterSize - 1;
        const isFirstRow = iy % clusterSize === 0;
        const isLastRow = iy % clusterSize === clusterSize - 1;

        // elastic0: one texel to the right; every 4th column references self
        const rx = isLastCol ? ix : ix < w - 1 ? ix + 1 : ix;
        conn0Arr[i4] = (rx + 0.5) / w;
        conn0Arr[i4 + 1] = selfV;
        conn0Arr[i4 + 2] = oneTexelX;
        conn0Arr[i4 + 3] = elasticityA;

        // elastic1: one texel to the left; every 4th column references self
        const lx = isFirstCol ? ix : ix > 0 ? ix - 1 : ix;
        conn1Arr[i4] = (lx + 0.5) / w;
        conn1Arr[i4 + 1] = selfV;
        conn1Arr[i4 + 2] = oneTexelX;
        conn1Arr[i4 + 3] = elasticityA;

        // elastic2: one texel up; every 4th row references self
        const uy = isFirstRow ? iy : iy > 0 ? iy - 1 : iy;
        conn2Arr[i4] = selfU;
        conn2Arr[i4 + 1] = (uy + 0.5) / h;
        conn2Arr[i4 + 2] = oneTexelY;
        conn2Arr[i4 + 3] = elasticityA;

        // elastic3: one texel down; every 4th row references self
        const dy = isLastRow ? iy : iy < h - 1 ? iy + 1 : iy;
        conn3Arr[i4] = selfU;
        conn3Arr[i4 + 1] = (dy + 0.5) / h;
        conn3Arr[i4 + 2] = oneTexelY;
        conn3Arr[i4 + 3] = elasticityA;
      }
    }
    const connTex0 = new DataTexture(conn0Arr, w, h, RGBAFormat, FloatType);
    const connTex1 = new DataTexture(conn1Arr, w, h, RGBAFormat, FloatType);
    const connTex2 = new DataTexture(conn2Arr, w, h, RGBAFormat, FloatType);
    const connTex3 = new DataTexture(conn3Arr, w, h, RGBAFormat, FloatType);
    for (const t of [connTex0, connTex1, connTex2, connTex3]) {
      t.flipY = flipY;
      t.needsUpdate = true;
      t.minFilter = NearestFilter;
      t.magFilter = NearestFilter;
      t.colorSpace = NoColorSpace;
    }
    this.elasticConnTex0 = connTex0;
    this.elasticConnTex1 = connTex1;
    this.elasticConnTex2 = connTex2;
    this.elasticConnTex3 = connTex3;

    const pointsArr = new Float32Array(count * 3);
    for (let ix = 0; ix < w; ix++) {
      for (let iy = 0; iy < h; iy++) {
        const i = ix * h + iy;
        const i3 = i * 3;
        pointsArr[i3] = (ix + 0.5) / w;
        pointsArr[i3 + 1] = (iy + 0.5) / h;
        pointsArr[i3 + 2] = i / count;
        // if (ix < 4 && iy < 4) {
        //   pointsArr[i3] += Math.random() * -0.02
        //   pointsArr[i3 + 1] += Math.random() * -0.02
        // }
      }
    }
    const pointsPosAttr = new Float32BufferAttribute(pointsArr, 3);
    pointsGeom.setAttribute("position", pointsPosAttr);
    pointsPosAttr.needsUpdate = true;

    const pointsMat = new PointsMaterial({
      color: 0xffffff,
      size: 0.0125,
      sizeAttenuation: true,
    });
    this.pointsMat = pointsMat;

    const ingoingPositionTextureUniform = {
      value: positionRT.texture,
    };
    this.ingoingPositionTextureUniform = ingoingPositionTextureUniform;
    pointsMat.onBeforeCompile = (shader) => {
      shader.uniforms.positionTexture = ingoingPositionTextureUniform;

      shader.vertexShader = shader.vertexShader.replace(
        `#include <common>`,
        `#include <common>
        uniform sampler2D positionTexture;
        varying float vTint;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
        vec4 posTex = texture2D(positionTexture, position.xy);
        transformed = posTex.xyz;
        vTint = position.z;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <common>`,
        `#include <common>
        varying float vTint;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <premultiplied_alpha_fragment>`,
        `#include <premultiplied_alpha_fragment>
        gl_FragColor.r = vTint;
        gl_FragColor.g = 1.0 - vTint;
        gl_FragColor.b = fract(vTint * 100.0);`
      );
    };

    const initPositionMat = new MeshBasicMaterial({
      map: initPositionTexture,
      // side: DoubleSide,
    });
    this.initPositionMat = initPositionMat;

    const initVelocityMat = new MeshBasicMaterial({
      map: initVelocityTexture,
      // side: DoubleSide,
    });
    this.initVelocityMat = initVelocityMat;

    const velocityIntegrationMat = new MeshBasicMaterial({
      map: velocityRT.texture,
      // side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.velocityIntegrationMat = velocityIntegrationMat;
    const boundaryLoopMat = new MeshBasicMaterial({
      map: positionRT.texture,
      // side: DoubleSide,
    });
    boundaryLoopMat.onBeforeCompile = (shader) => {
      shader.uniforms.map = ingoingPositionTextureUniform;
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <premultiplied_alpha_fragment>`,
        `#include <premultiplied_alpha_fragment>
        gl_FragColor.xy = fract(gl_FragColor.xy);
        gl_FragColor.z = 0.0;
        gl_FragColor.w = 1.0;
        `
      );
    };
    this.boundaryLoopMat = boundaryLoopMat;

    const planeGeo = new PlaneGeometry(1, 1);
    const planeVerts = planeGeo.attributes.position;
    const vertsArr = planeVerts.array as Float32Array;
    for (let i = 0; i < vertsArr.length / 3; i++) {
      vertsArr[i * 3] += 0.5;
      vertsArr[i * 3 + 1] *= -1;
      vertsArr[i * 3 + 1] += 0.5;
    }
    planeVerts.needsUpdate = true;

    const plane = new Mesh(planeGeo, initVelocityMat);
    this.plane = plane;
    this.scene.add(plane);
    this.scene.add(this.camera);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();

    const pressurePointsMat = new PointsMaterial({
      size: 0.5,
      blending: AdditiveBlending,
      // blendEquation: AddEquation,
      // blending: CustomBlending,
      // blendDst: OneFactor,
      // blendSrc: OneFactor,
      // sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      opacity: 1.0,
      color: new Color(0.1, 0.1, 0.1),
    });

    pressurePointsMat.onBeforeCompile = (shader) => {
      shader.uniforms.positionTexture = ingoingPositionTextureUniform;

      shader.vertexShader = shader.vertexShader.replace(
        `#include <common>`,
        `#include <common>
        uniform sampler2D positionTexture;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        `#include <begin_vertex>`,
        `#include <begin_vertex>
        vec4 posTex = texture2D(positionTexture, position.xy);
        transformed = vec3(posTex.xy, 0.0);`
      );
    };
    this.pressurePointsMat = pressurePointsMat;

    const pressureVectorToVelocityIntegrationMat = new MeshBasicMaterial({
      map: positionRT.texture,
      // opacity: 0.1,
      // transparent: true,
      blending: AdditiveBlending,
      // side: DoubleSide,
    });
    pressureVectorToVelocityIntegrationMat.onBeforeCompile = (shader) => {
      shader.uniforms.map = ingoingPositionTextureUniform;
      shader.uniforms.pressureVectorTexture = {
        value: pressureVectorRT.texture,
      };
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <common>`,
        `
        #include <common>
        uniform sampler2D pressureVectorTexture;
      `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <premultiplied_alpha_fragment>`,
        `#include <premultiplied_alpha_fragment>
        vec4 posTex = texture2D( map, vMapUv);
        vec4 pressure = texture2D(pressureVectorTexture, posTex.xy);
        gl_FragColor = vec4(pressure.x, pressure.y, 0.0, 1.0);
      `
      );
    };
    this.pressureVectorToVelocityIntegrationMat = pressureVectorToVelocityIntegrationMat;

    // Phase 3: compute elastic forces and add directly to velocityRT (additive)
    const elasticForcesToVelocityMat = new MeshBasicMaterial({
      map: positionRT.texture,
      blending: AdditiveBlending,
      transparent: true,
    });
    // keep userData for live updates
    elasticForcesToVelocityMat.userData = elasticForcesToVelocityMat.userData || {};
    elasticForcesToVelocityMat.onBeforeCompile = (shader) => {
      shader.uniforms.map = ingoingPositionTextureUniform;
      shader.uniforms.conn0 = { value: this.elasticConnTex0 };
      shader.uniforms.conn1 = { value: this.elasticConnTex1 };
      shader.uniforms.conn2 = { value: this.elasticConnTex2 };
      shader.uniforms.conn3 = { value: this.elasticConnTex3 };
      shader.uniforms.elasticStiffness = {
        value: physicsSettings.elasticityDefault ?? 1.0,
      };
      elasticForcesToVelocityMat.userData.elasticStiffness = shader.uniforms.elasticStiffness;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `
        #include <common>
        uniform sampler2D conn0;
        uniform sampler2D conn1;
        uniform sampler2D conn2;
        uniform sampler2D conn3;
        uniform float elasticStiffness;

        vec2 springForce(sampler2D posTex, sampler2D connTex, vec2 uvSelf, vec3 selfPos) {
          vec4 c = texture2D(connTex, uvSelf);
          vec2 uvN = c.xy;
          float restLen = c.z;
          float a = c.w;

          vec3 neighborPos = texture2D(posTex, uvN).xyz;
          // compute shortest wrapped distance per axis (world assumed in [0,1] range)
          vec2 d = neighborPos.xy - selfPos.xy;
          d = fract(d + 0.5) - 0.5;
          float len = length(d);
          if (len < 1e-6) return vec2(0.0);
          vec2 dir = d / len;
          float stretch = len - restLen;
          // Hooke's law: F = k * stretch in direction to neighbor
          vec2 f = dir * (stretch * (elasticStiffness * a));
          return f;
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <premultiplied_alpha_fragment>",
        `
        #include <premultiplied_alpha_fragment>
        vec4 selfPosTex = texture2D(map, vMapUv);
        vec3 selfPos = selfPosTex.xyz;

        vec2 f = vec2(0.0);
        f += springForce(map, conn0, vMapUv, selfPos);
        f += springForce(map, conn1, vMapUv, selfPos);
        f += springForce(map, conn2, vMapUv, selfPos);
        f += springForce(map, conn3, vMapUv, selfPos);

        gl_FragColor = vec4(f * 0.025, 0.0, 1.0);
        `
      );
    };
    this.elasticForcesToVelocityMat = elasticForcesToVelocityMat;

    const dataPoints = new Points(pointsGeom, pressurePointsMat);
    this.dataPoints = dataPoints;
    this.pointScene.add(dataPoints);
    this.pointScene.add(this.pointCamera);
    this.pointCamera.updateMatrixWorld();
    this.pointCamera.updateProjectionMatrix();

    const pressureVectorMat = new MeshBasicMaterial({
      map: pressureSoftRT.texture,
      // side: DoubleSide,
    });
    // ensure userData exists
    pressureVectorMat.userData = pressureVectorMat.userData || {};
    pressureVectorMat.onBeforeCompile = (shader) => {
      shader.defines = {
        TEXEL_SIZE,
      };
      shader.uniforms.map = ingoingPositionTextureUniform;
      shader.uniforms.pressureVectorStrength = {
        value: new Vector2(
          physicsSettings.pressureVectorStrength,
          physicsSettings.pressureVectorStrength
        ),
      };
      // keep a live reference for HMR updates
      pressureVectorMat.userData.pressureVectorStrength =
        shader.uniforms.pressureVectorStrength.value;

      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <common>`,
        `#include <common>
        uniform vec2 pressureVectorStrength;
        `
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <map_fragment>`,
        ShaderChunk.map_fragment.replace(
          `vec4 sampledDiffuseColor = texture2D( map, vMapUv );`,
          `
          vec2 uv = vMapUv;
          // vec2 uv = vec2(vMapUv.x, vMapUv.y);
          vec4 sampledDiffuseColor = vec4(0.0, 0.0, 0.0, 1.0);
          sampledDiffuseColor.r = texture2D( map, fract(uv - vec2(TEXEL_SIZE, 0.0))).r - texture2D( map, fract(uv + vec2(TEXEL_SIZE, 0.0))).r;
          sampledDiffuseColor.g = texture2D( map, fract(uv - vec2(0.0, TEXEL_SIZE))).g - texture2D( map, fract(uv + vec2(0.0, TEXEL_SIZE))).g;
          sampledDiffuseColor.rg *= pressureVectorStrength;
          `
        )
      );
    };
    this.pressureVectorMat = pressureVectorMat;

    const pressureSoftMat = new MeshBasicMaterial({
      map: pressureRT.texture,
      // side: DoubleSide,
    });
    pressureSoftMat.onBeforeCompile = (shader) => {
      shader.defines = {
        TEXEL_SIZE,
      };
      shader.uniforms.map = ingoingPositionTextureUniform;
      shader.fragmentShader = shader.fragmentShader.replace(
        `#include <map_fragment>`,
        ShaderChunk.map_fragment.replace(
          `vec4 sampledDiffuseColor = texture2D( map, vMapUv );`,
          `
          // vec2 uv = vec2(vMapUv.x, vMapUv.y);
          vec2 uv = vMapUv;
          float s = max(0.0, texture2D( map, uv).r-0.1) * 2.0;
          s += max(0.0, texture2D( map, fract(uv - vec2(TEXEL_SIZE, 0.0))).r - 0.1);
          s += max(0.0, texture2D( map, fract(uv + vec2(TEXEL_SIZE, 0.0))).r - 0.1);
          s += max(0.0, texture2D( map, fract(uv - vec2(0.0, TEXEL_SIZE))).r - 0.1);
          s += max(0.0, texture2D( map, fract(uv + vec2(0.0, TEXEL_SIZE))).r - 0.1);
          s *= 0.1666;
          vec4 sampledDiffuseColor = vec4(s, s, s, 1.0);
          `
        )
      );
    };
    this.pressureSoftMat = pressureSoftMat;

    const velocityFrictionMat = new MeshBasicMaterial({
      color: gravityColor,
      transparent: true,
      opacity: physicsSettings.frictionCoeff,
      // side: DoubleSide,
    });
    this.velocityFrictionMat = velocityFrictionMat;

    const visuals = new Object3D();
    const texturesToPreview = [
      [positionRT.texture, 0.1],
      [velocityRT.texture, 1000],
      [pressureRT.texture, 0.125],
      [pressureSoftRT.texture, 0.125],
      [pressureVectorRT.texture, 1000],
      // Phase 2: elastic connection DataTextures (optional debug preview)
      [this.elasticConnTex0, 2.0],
      [this.elasticConnTex1, 2.0],
      [this.elasticConnTex2, 2.0],
      [this.elasticConnTex3, 2.0],
      // [obstacleTexture, 1000],
      // [pressureVectorRemappedRT.texture, 1000],
    ] as const;
    for (let i = 0; i < texturesToPreview.length; i++) {
      const texture = texturesToPreview[i];
      const b = texture[1];
      const previewPlane = new Mesh(
        planeGeo,
        new MeshBasicMaterial({
          map: texture[0],
          // map: velocityRT.texture,
          side: BackSide,
          color: new Color(b, b, b),
          // map: pressureRT.texture,
          // map: pressureSoftRT.texture,
          // map: pressureVectorRT.texture,
          // map: obstacleTexture,
        })
      );
      // previewPlane.visible = false
      // visuals.add(previewPlane);
      previewPlane.position.set((i % 4) * 0.25, 0.25 * -Math.floor(i / 4), -0.001);
      previewPlane.scale.set(0.25, 0.25, 1);
      // const points = new Points(pointsGeom, pointsMat);
      // points.position.set(i % 3, -Math.floor(i / 3) + 1, 0);
      // points.scale.set(1, -1, 1);
      // visuals.add(points);
    }
    const points = new Points(pointsGeom, pointsMat);
    points.position.set(-0.5, 0.5, 0);
    visuals.add(points);
    points.scale.set(1, -1, 1);
    visuals.scale.setScalar(8);
    this.visuals = visuals;
  }

  private applyPhysicsSettings(next: typeof physicsSettings) {
    // Update gravity color green channel to reflect gravity value
    gravityColor.setRGB(next.wind, next.gravity, 0);
    if (this.velocityFrictionMat) {
      this.velocityFrictionMat.color.copy(gravityColor);
      this.velocityFrictionMat.opacity = next.frictionCoeff ?? this.velocityFrictionMat.opacity;
      this.velocityFrictionMat.needsUpdate = true;
      this.velocityFrictionMat.transparent =
        this.velocityFrictionMat.opacity < 1.0 || this.velocityFrictionMat.transparent;
    }
    // Update pressure vector strength uniform if compiled
    if (this.pressureVectorMat) {
      const mat = this.pressureVectorMat;
      const u: Vector2 | undefined = mat.userData.pressureVectorStrength;
      if (u && typeof u.set === "function") {
        u.set(next.pressureVectorStrength, next.pressureVectorStrength);
      }
    }
    // Update elastic stiffness
    if (
      this.elasticForcesToVelocityMat &&
      this.elasticForcesToVelocityMat.userData?.elasticStiffness
    ) {
      this.elasticForcesToVelocityMat.userData.elasticStiffness.value =
        next.elasticityDefault ?? this.elasticForcesToVelocityMat.userData.elasticStiffness.value;
    }
  }

  firstTime = true;
  update(renderer: WebGLRenderer) {
    if (this.firstTime) {
      this.firstTime = false;
      this.plane.material = this.initPositionMat;
      renderer.setRenderTarget(this.positionRT);
      renderer.render(this.scene, this.camera);
      this.plane.material = this.initVelocityMat;
      renderer.setRenderTarget(this.velocityRT);
      renderer.render(this.scene, this.camera);
    }

    this.plane.material = this.velocityIntegrationMat;
    renderer.setRenderTarget(this.positionRT);
    renderer.render(this.scene, this.camera);
    this.swapPositionRTs();

    renderer.setRenderTarget(this.pressureRT);
    renderer.clearColor();
    this.dataPoints.material = this.pressurePointsMat;
    renderer.render(this.pointScene, this.pointCamera);
    this.plane.material = this.obstacleMat;
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.pressureSoftRT);
    this.plane.material = this.pressureSoftMat;
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.pressureVectorRT);
    this.plane.material = this.pressureVectorMat;
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(this.velocityRT);
    this.plane.material = this.pressureVectorToVelocityIntegrationMat;
    renderer.render(this.scene, this.camera);
    // Phase 4: add elastic forces directly into velocity (additive)
    this.plane.material = this.elasticForcesToVelocityMat;
    renderer.render(this.scene, this.camera);

    // renderer.setRenderTarget(this.velocityRT)
    this.plane.material = this.velocityFrictionMat;
    renderer.render(this.scene, this.camera);

    // this.swapPositionRTs()
    renderer.setRenderTarget(this.positionRT);
    this.plane.material = this.boundaryLoopMat;
    renderer.render(this.scene, this.camera);
    this.swapPositionRTs();
    renderer.setRenderTarget(this.positionRT);
    renderer.render(this.scene, this.camera);
    this.swapPositionRTs();
    // renderer.setRenderTarget(this.positionRT)
    // renderer.render(this.scene, this.camera)
    // this.swapPositionRTs()
    // renderer.setRenderTarget(this.positionRT)
    // renderer.render(this.scene, this.camera)
    // this.swapPositionRTs()
    // renderer.setRenderTarget(this.positionRT)
    // renderer.render(this.scene, this.camera)
    // this.swapPositionRTs()

    renderer.setRenderTarget(null);
  }
  swapPositionRTs() {
    const temp = this.positionRT;
    this.positionRT = this.positionRTBackBuffer;
    this.positionRTBackBuffer = temp;

    this.boundaryLoopMat.map = this.positionRTBackBuffer.texture;
    this.elasticForcesToVelocityMat.map = this.positionRTBackBuffer.texture;

    this.ingoingPositionTextureUniform.value = this.positionRTBackBuffer.texture;
  }
}
