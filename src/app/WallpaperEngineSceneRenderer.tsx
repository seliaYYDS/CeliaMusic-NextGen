import { convertFileSrc } from "@tauri-apps/api/core";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import type {
  WallpaperEngineSceneEffect,
  WallpaperEngineSceneLayer,
  WallpaperEngineSceneMaterialPass,
  WallpaperEngineScenePuppetMesh,
  WallpaperEngineSceneRuntime,
  WallpaperEngineSceneScriptValue,
} from "./wallpaperEngine";

type ScriptModule = {
  init?: (value: unknown) => void;
  update?: (value: unknown) => unknown;
};

type ResolvedLayer = WallpaperEngineSceneLayer & {
  resolvedX: number;
  resolvedY: number;
  resolvedScaleX: number;
  resolvedScaleY: number;
  resolvedRotationZDegrees: number;
  resolvedAlpha: number;
  resolvedText: string | null;
  resolvedVisible: boolean;
};

function isVideoAssetPath(path: string) {
  const normalizedPath = path.toLowerCase();
  return normalizedPath.endsWith(".mp4") || normalizedPath.endsWith(".webm") || normalizedPath.endsWith(".mkv");
}

export function WallpaperEngineSceneRenderer({
  runtime,
  className,
}: {
  runtime: WallpaperEngineSceneRuntime;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const resolvedLayers = useResolvedLayers(runtime);
  const canvasWidth = Math.max(1, runtime.canvasWidth);
  const canvasHeight = Math.max(1, runtime.canvasHeight);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      setViewportSize((current) => current.width === width && current.height === height ? current : { width, height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const scale = Math.max(viewportSize.width / canvasWidth || 1, viewportSize.height / canvasHeight || 1);
  const offsetX = (viewportSize.width - (canvasWidth * scale)) / 2;
  const offsetY = (viewportSize.height - (canvasHeight * scale)) / 2;

  return (
    <div ref={containerRef} className={["wallpaper-engine-scene", className].filter(Boolean).join(" ")}>
      <div
        className="wallpaper-engine-scene__canvas"
        style={{
          width: `${canvasWidth}px`,
          height: `${canvasHeight}px`,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
        }}
      >
        <SceneWebGLCompositor runtime={runtime} layers={resolvedLayers} />
      </div>
    </div>
  );
}

// Kept as a compatibility fallback for callers that rely on the legacy layer node.
void WallpaperEngineSceneLayerNode;

type SceneTarget = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };

/**
 * WebGL implementation of the CScene -> CImage -> CPass flow used by
 * linux-wallpaperengine.  Objects are first rendered into an object-local
 * ping-pong pair; effect passes can redirect to a named target and bind either
 * that target or the pre-effect input.  Only the completed object is blended
 * into the scene target.  This deliberately keeps every intermediate on the
 * GPU: Tauri file URLs must never be copied through a DOM canvas.
 */
function SceneWebGLCompositor({ runtime, layers }: { runtime: WallpaperEngineSceneRuntime; layers: ResolvedLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const latestLayers = useRef(layers);
  latestLayers.current = layers;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return;

    const sceneWidth = Math.max(1, Math.round(runtime.canvasWidth));
    const sceneHeight = Math.max(1, Math.round(runtime.canvasHeight));
    canvas.width = sceneWidth;
    canvas.height = sceneHeight;

    const programs = createScenePrograms(gl);
    if (!programs) return;
    const quad = createSceneQuad(gl);
    const scene = createSceneTarget(gl, sceneWidth, sceneHeight);
    const pingA = createSceneTarget(gl, sceneWidth, sceneHeight);
    const pingB = createSceneTarget(gl, sceneWidth, sceneHeight);
    if (!quad || !scene || !pingA || !pingB) return;

    const sourceTextures = new Map<string, WebGLTexture>();
    const puppetBuffers = new Map<number, { position: WebGLBuffer; uv: WebGLBuffer; index: WebGLBuffer; count: number }>();
    const queuedTextures = new Set<string>();
    const loading = new Set<string>();
    const textureQueue: string[] = [];
    const namedTargets = new Map<string, SceneTarget>();
    let cancelled = false;
    let frame = 0;
    let start = performance.now();

    const pumpTextureQueue = () => {
      while (!cancelled && loading.size < 2 && textureQueue.length > 0) {
        const path = textureQueue.shift();
        if (!path) continue;
        queuedTextures.delete(path);
        loading.add(path);
        void loadSceneTexture(gl, path).then((texture) => {
          if (!cancelled && texture) sourceTextures.set(path, texture);
        }).finally(() => {
          loading.delete(path);
          pumpTextureQueue();
        });
      }
    };
    const getTexture = (path: string | null | undefined) => {
      if (!path || path.startsWith("_rt_") || path.startsWith("_alias_")) return null;
      const existing = sourceTextures.get(path);
      if (existing) return existing;
      if (!queuedTextures.has(path) && !loading.has(path)) {
        queuedTextures.add(path);
        textureQueue.push(path);
        pumpTextureQueue();
      }
      return null;
    };

    const targetFor = (name: string) => {
      const existing = namedTargets.get(name);
      if (existing) return existing;
      const target = createSceneTarget(gl, sceneWidth, sceneHeight);
      if (target) namedTargets.set(name, target);
      return target ?? null;
    };

    const render = (now: number) => {
      if (cancelled || gl.isContextLost()) return;
      const sceneLayers = latestLayers.current;
      const elapsed = (now - start) / 1000;
      clearSceneTarget(gl, scene);

      for (const layer of sceneLayers) {
        if (!layer.resolvedVisible || layer.resolvedAlpha <= 0) continue;
        const isUtility = layer.kind === "solid" || Boolean(layer.utilLayerKind);
        const effectPasses = expandEffectPasses(layer.effects);
        const materialPasses = !isUtility && layer.materialPasses.length > 1 ? layer.materialPasses.slice(1) : [];
        const passes = [...materialPasses.map((pass) => ({ pass, effect: null })), ...effectPasses];
        const baseTexture = getTexture(layer.imagePath) ?? transparentSceneTexture(gl);

        // Most simple scene images have one material pass and no effects. The
        // reference path can draw those directly to the scene FBO; allocating
        // and clearing two full-resolution object targets for each such image
        // is both unnecessary and the main source of frame-time spikes.
        if (!isUtility && passes.length === 0 && (layer.kind === "image" || layer.kind === "text")) {
          if (layer.puppetMesh) {
            drawScenePuppet(gl, programs.copy, scene, baseTexture, layer, sceneWidth, sceneHeight, elapsed, puppetBuffers);
          } else {
            drawSceneLayer(gl, programs.copy, quad, scene, baseTexture, layer, sceneWidth, sceneHeight, elapsed, resolveBlendMode(layer.materialPasses[0]?.blending));
          }
          continue;
        }
        let input: WebGLTexture = baseTexture;
        let current = pingA;
        let alternate = pingB;
        let didRender = false;

        if (!isUtility && (layer.kind === "image" || layer.kind === "text")) {
          clearSceneTarget(gl, current);
          if (layer.puppetMesh) {
            drawScenePuppet(gl, programs.copy, current, input, layer, sceneWidth, sceneHeight, elapsed, puppetBuffers);
          } else {
            drawSceneLayer(gl, programs.copy, quad, current, input, layer, sceneWidth, sceneHeight, elapsed, "normal");
          }
          input = current.texture;
          [current, alternate] = [alternate, current];
          didRender = true;
        }

        let effectInput: WebGLTexture | null = null;
        let inTargetSequence = false;

        if (isUtility) {
          input = scene.texture;
          didRender = passes.length > 0;
        }

        for (const entry of passes) {
          const pass = entry.pass;
          const targetName = entry.effect?.target ?? null;
          const target = targetName ? targetFor(targetName) : null;
          const destination = target ?? current;
          if (target && !inTargetSequence) {
            effectInput = input;
            inTargetSequence = true;
          }
          if (!target) clearSceneTarget(gl, destination);
          drawScenePass(gl, programs, quad, destination, input, layer, pass, entry.effect, namedTargets, effectInput, sceneWidth, sceneHeight, elapsed, getTexture);
          input = destination.texture;
          didRender = true;
          if (!target) {
            [current, alternate] = [alternate, current];
            inTargetSequence = false;
            effectInput = null;
          }
        }

        if (isUtility) {
          if (didRender) drawSceneComposite(gl, programs.copy, quad, scene, input, elapsed, "normal");
        } else if (didRender) {
          drawSceneComposite(gl, programs.copy, quad, scene, input, elapsed, resolveBlendMode(layer.materialPasses[0]?.blending));
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, sceneWidth, sceneHeight);
      gl.disable(gl.BLEND);
      drawSceneComposite(gl, programs.copy, quad, null, scene.texture, elapsed, "normal", true);
      frame = window.requestAnimationFrame(render);
    };
    frame = window.requestAnimationFrame(render);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      sourceTextures.forEach((texture) => gl.deleteTexture(texture));
      puppetBuffers.forEach((buffer) => { gl.deleteBuffer(buffer.position); gl.deleteBuffer(buffer.uv); gl.deleteBuffer(buffer.index); });
      namedTargets.forEach((target) => deleteSceneTarget(gl, target));
      deleteSceneTarget(gl, scene); deleteSceneTarget(gl, pingA); deleteSceneTarget(gl, pingB);
      gl.deleteBuffer(quad.position); gl.deleteBuffer(quad.uv);
      gl.deleteProgram(programs.copy); gl.deleteProgram(programs.effect);
    };
  }, [runtime]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__webgl-canvas" aria-hidden="true" />;
}

function expandEffectPasses(effects: WallpaperEngineSceneEffect[]) {
  return effects.filter((effect) => effect.visible).flatMap((effect) => {
    if (effect.materialPasses.length) return effect.materialPasses.map((pass) => ({ pass, effect }));
    if (effect.command?.toLowerCase() === "copy") return [{ pass: emptyScenePass(), effect }];
    return [];
  });
}

function emptyScenePass(): WallpaperEngineSceneMaterialPass {
  return { shader: "commands/copy", textures: [], constants: null, combos: null, blending: "normal", cullMode: null, depthTest: null, depthWrite: null };
}

function createScenePrograms(gl: WebGLRenderingContext) {
  const vertex = `attribute vec2 aPosition; attribute vec2 aUv; uniform mat3 uTransform; uniform float uFlipY; varying vec2 vUv;
void main(){ vec3 p=uTransform*vec3(aPosition,1.0); gl_Position=vec4(p.xy,0.0,1.0); vUv=vec2(aUv.x,mix(aUv.y,1.0-aUv.y,uFlipY)); }`;
  const copy = compileSceneProgram(gl, vertex, `precision mediump float; varying vec2 vUv; uniform sampler2D uTexture0; uniform float uAlpha;
void main(){ vec4 c=texture2D(uTexture0,vUv); gl_FragColor=vec4(c.rgb,c.a)*uAlpha; }`);
  const effect = compileSceneProgram(gl, vertex, `precision mediump float; varying vec2 vUv; uniform sampler2D uTexture0; uniform sampler2D uTexture1; uniform sampler2D uTexture2; uniform sampler2D uTexture3; uniform float uTime; uniform vec2 uTexel; uniform float uAlpha; uniform float uEffect;
void main(){ vec2 uv=vUv; vec4 c=texture2D(uTexture0,uv); if(uEffect==1.0){ vec2 n=texture2D(uTexture1,uv+vec2(uTime*.025,uTime*.017)).rg-.5; c=texture2D(uTexture0,uv+n*.045); } else if(uEffect==2.0){ vec4 b=(texture2D(uTexture0,uv+vec2(uTexel.x,0.0))+texture2D(uTexture0,uv-vec2(uTexel.x,0.0))+texture2D(uTexture0,uv+vec2(0.0,uTexel.y))+texture2D(uTexture0,uv-vec2(0.0,uTexel.y)))*.25; c=mix(c,b,.55); } gl_FragColor=vec4(c.rgb,c.a)*uAlpha; }`);
  return copy && effect ? { copy, effect } : null;
}

function compileSceneProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const compile = (kind: number, source: string) => { const shader = gl.createShader(kind); if (!shader) return null; gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; } return shader; };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource); const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram(); if (!program) return null;
  gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }
  return program;
}

function createSceneQuad(gl: WebGLRenderingContext) {
  const position = gl.createBuffer(); const uv = gl.createBuffer(); if (!position || !uv) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, position); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
  return { position, uv };
}

function createSceneTarget(gl: WebGLRenderingContext, width: number, height: number): SceneTarget | null {
  const texture = gl.createTexture(); const framebuffer = gl.createFramebuffer(); if (!texture || !framebuffer) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE ? { texture, framebuffer, width, height } : null;
}

function deleteSceneTarget(gl: WebGLRenderingContext, target: SceneTarget) { gl.deleteFramebuffer(target.framebuffer); gl.deleteTexture(target.texture); }
function clearSceneTarget(gl: WebGLRenderingContext, target: SceneTarget) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.viewport(0,0,target.width,target.height); gl.disable(gl.BLEND); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
const transparentTextures = new WeakMap<WebGLRenderingContext, WebGLTexture>();
function transparentSceneTexture(gl: WebGLRenderingContext) { const existing = transparentTextures.get(gl); if (existing) return existing; const texture=gl.createTexture(); if (!texture) throw new Error("WebGL texture allocation failed"); gl.bindTexture(gl.TEXTURE_2D,texture); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0])); transparentTextures.set(gl,texture); return texture; }

async function loadSceneTexture(gl: WebGLRenderingContext, path: string) {
  try { const response = await fetch(convertFileSrc(path)); if (!response.ok) return null; const bitmap = await createImageBitmap(await response.blob()); const texture=gl.createTexture(); if (!texture) { bitmap.close(); return null; } gl.bindTexture(gl.TEXTURE_2D,texture); /* Decoded WE TEX rows are already in GL order. */ gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap); bitmap.close(); return texture; } catch { return null; }
}

function bindSceneQuad(gl: WebGLRenderingContext, program: WebGLProgram, quad: {position: WebGLBuffer;uv: WebGLBuffer}) { const pos=gl.getAttribLocation(program,"aPosition"); const uv=gl.getAttribLocation(program,"aUv"); gl.bindBuffer(gl.ARRAY_BUFFER,quad.position); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0); gl.bindBuffer(gl.ARRAY_BUFFER,quad.uv); gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv,2,gl.FLOAT,false,0,0); }
function setSceneUniform1f(gl: WebGLRenderingContext, program: WebGLProgram, name: string, value: number) { const loc=gl.getUniformLocation(program,name); if(loc) gl.uniform1f(loc,value); }
function setSceneUniform1i(gl: WebGLRenderingContext, program: WebGLProgram, name: string, value: number) { const loc=gl.getUniformLocation(program,name); if(loc) gl.uniform1i(loc,value); }
function drawSceneLayer(gl: WebGLRenderingContext, program: WebGLProgram, quad: {position: WebGLBuffer;uv: WebGLBuffer}, destination: SceneTarget, texture: WebGLTexture, layer: ResolvedLayer, width: number, height: number, time: number, blend: string) { gl.bindFramebuffer(gl.FRAMEBUFFER,destination.framebuffer); gl.viewport(0,0,destination.width,destination.height); drawSceneTexture(gl,program,quad,texture,layerTransform(layer,width,height),layer.resolvedAlpha,time,blend); }
function drawScenePuppet(gl: WebGLRenderingContext, program: WebGLProgram, destination: SceneTarget, texture: WebGLTexture, layer: ResolvedLayer, sceneWidth: number, sceneHeight: number, sceneTime: number, buffers: Map<number, { position: WebGLBuffer; uv: WebGLBuffer; index: WebGLBuffer; count: number }>) {
  const mesh = layer.puppetMesh;
  if (!mesh) return;
  let buffer = buffers.get(layer.id);
  if (!buffer) {
    const position = gl.createBuffer(); const uv = gl.createBuffer(); const index = gl.createBuffer();
    if (!position || !uv || !index) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, uv); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.texCoords), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
    buffer = { position, uv, index, count: mesh.indices.length }; buffers.set(layer.id, buffer);
  }
  // The MDLV vertices are in model space.  Animation updates the same dynamic
  // position buffer, while UV and index buffers remain exactly as packaged.
  // Follow CImage::updatePuppetPositionBuffer from linux-wallpaperengine:
  // MDLV mesh coordinates are already the authoritative bind pose.  Do not
  // apply the incomplete MDLA interpretation here, as that mirrors and
  // dislocates individual weighted parts.
  void sceneTime;
  const modelPositions = mesh.positions;
  const positions: number[] = [];
  for (let index = 0; index + 2 < modelPositions.length; index += 3) {
    positions.push(((modelPositions[index] / Math.max(1, layer.width)) * 2) - 1, ((modelPositions[index + 1] / Math.max(1, layer.height)) * 2) - 1, modelPositions[index + 2]);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer); gl.viewport(0, 0, destination.width, destination.height);
  gl.useProgram(program); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture); setSceneUniform1i(gl, program, "uTexture0", 0);
  setSceneUniform1f(gl, program, "uFlipY", 0);
  const matrix = gl.getUniformLocation(program, "uTransform"); if (matrix) gl.uniformMatrix3fv(matrix, false, new Float32Array(layerTransform(layer, sceneWidth, sceneHeight)));
  setSceneUniform1f(gl, program, "uAlpha", layer.resolvedAlpha);
  const pos = gl.getAttribLocation(program, "aPosition"); const uv = gl.getAttribLocation(program, "aUv");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.position); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.uv); gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer.index); applySceneBlend(gl, "translucent"); gl.drawElements(gl.TRIANGLES, buffer.count, gl.UNSIGNED_SHORT, 0);
}
function drawSceneComposite(gl: WebGLRenderingContext, program: WebGLProgram, quad: {position: WebGLBuffer;uv: WebGLBuffer}, destination: SceneTarget | null, texture: WebGLTexture, time: number, blend: string, flipY = false) { gl.bindFramebuffer(gl.FRAMEBUFFER,destination?.framebuffer ?? null); gl.viewport(0,0,destination?.width ?? gl.canvas.width,destination?.height ?? gl.canvas.height); drawSceneTexture(gl,program,quad,texture,[1,0,0,0,1,0,0,0,1],1,time,blend,flipY); }
function drawSceneTexture(gl: WebGLRenderingContext, program: WebGLProgram, quad: {position: WebGLBuffer;uv: WebGLBuffer}, texture: WebGLTexture, transform: number[], alpha: number, _time: number, blend: string, flipY = false) { gl.useProgram(program); bindSceneQuad(gl,program,quad); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture); setSceneUniform1i(gl,program,"uTexture0",0); const matrix=gl.getUniformLocation(program,"uTransform"); if(matrix) gl.uniformMatrix3fv(matrix,false,new Float32Array(transform)); setSceneUniform1f(gl,program,"uAlpha",Math.max(0,Math.min(1,alpha))); setSceneUniform1f(gl,program,"uFlipY",flipY ? 1 : 0); applySceneBlend(gl,blend); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
function drawScenePass(gl: WebGLRenderingContext, programs: {copy: WebGLProgram;effect: WebGLProgram}, quad: {position: WebGLBuffer;uv: WebGLBuffer}, destination: SceneTarget, input: WebGLTexture, layer: ResolvedLayer, pass: WallpaperEngineSceneMaterialPass, effect: WallpaperEngineSceneEffect | null, named: Map<string,SceneTarget>, previous: WebGLTexture | null, width: number, height: number, time: number, getTexture: (path: string | null | undefined) => WebGLTexture | null) { const shaderName=`${pass.shader ?? ""} ${effect?.kind ?? ""}`.toLowerCase(); const isEffect=/ripple|refract|distort|flowimage/.test(shaderName); const program=isEffect?programs.effect:programs.copy; gl.bindFramebuffer(gl.FRAMEBUFFER,destination.framebuffer); gl.viewport(0,0,destination.width,destination.height); gl.useProgram(program); bindSceneQuad(gl,program,quad); setSceneUniform1f(gl,program,"uFlipY",0); const resolve=(index:number) => { const bind=readSceneBind(effect?.binds,index); if(bind === "previous") return previous ?? input; if(bind && named.get(bind)) return named.get(bind)!.texture; const path=pass.textures[index] ?? effect?.texturePaths[index]; return path ? getTexture(path) : null; }; [input,resolve(1),resolve(2),resolve(3)].forEach((texture,index)=>{ gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,texture ?? transparentSceneTexture(gl)); setSceneUniform1i(gl,program,`g_Texture${index}`,index); setSceneUniform1i(gl,program,`uTexture${index}`,index); }); const matrix=gl.getUniformLocation(program,"uTransform"); if(matrix) gl.uniformMatrix3fv(matrix,false,new Float32Array([1,0,0,0,1,0,0,0,1])); setSceneUniform1f(gl,program,"uAlpha",layer.resolvedAlpha); setSceneUniform1f(gl,program,"uTime",time); const texel=gl.getUniformLocation(program,"uTexel"); if(texel) gl.uniform2f(texel,1/width,1/height); setSceneUniform1f(gl,program,"uEffect", /ripple|refract|distort|flowimage/.test(shaderName)?1:/blur/.test(shaderName)?2:0); applySceneBlend(gl,resolveBlendMode(pass.blending)); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); }
function readSceneBind(value: unknown, index: number) { if (Array.isArray(value)) return typeof value[index] === "string" ? value[index] : null; if (value && typeof value === "object") { const record=value as Record<string,unknown>; const candidate=record[String(index)] ?? record[`g_Texture${index}`]; return typeof candidate === "string" ? candidate : null; } return null; }
function resolveBlendMode(value: string | null | undefined) { return value?.toLowerCase() ?? "translucent"; }
function applySceneBlend(gl: WebGLRenderingContext, blend: string) { if(/add/.test(blend)){gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE,gl.ONE,gl.ONE);} else if(/normal|opaque/.test(blend)){gl.disable(gl.BLEND);} else {gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);} }
function layerTransform(layer: ResolvedLayer, sceneWidth: number, sceneHeight: number) {
  const width = Math.max(1, layer.width) * layer.resolvedScaleX;
  const height = Math.max(1, layer.height) * layer.resolvedScaleY;
  let originX = layer.resolvedX;
  let originY = layer.resolvedY;
  const anchor = layer.anchor?.toLowerCase() ?? "";

  // CImage resolves an object origin around the orthographic projection centre,
  // then applies alignment offsets before converting into OpenGL scene space.
  if (anchor.includes("top")) originY -= height / 2;
  else if (anchor.includes("bottom")) originY += height / 2;
  if (anchor.includes("left")) originX += width / 2;
  else if (anchor.includes("right")) originX -= width / 2;

  const centerX = ((originX / sceneWidth) * 2) - 1;
  const centerY = 1 - ((originY / sceneHeight) * 2);
  const radians = layer.resolvedRotationZDegrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    cos * width / sceneWidth, sin * width / sceneWidth, 0,
    -sin * height / sceneHeight, cos * height / sceneHeight, 0,
    centerX, centerY, 1,
  ];
}

function useResolvedLayers(runtime: WallpaperEngineSceneRuntime) {
  const [layers, setLayers] = useState<ResolvedLayer[]>(() => resolveLayers(runtime.layers.map(resolveStaticLayer)));

  useEffect(() => {
    const needsFrameUpdates = runtime.layers.some((layer) =>
      Boolean(
        layer.dynamicOrigin ||
        layer.dynamicScale ||
        layer.dynamicAngles ||
        layer.dynamicAlpha ||
        layer.dynamicText ||
        layer.dynamicVisible ||
        layer.kind === "particle",
      ),
    );
    const evaluators = runtime.layers.map((layer) => createLayerEvaluator(layer, runtime));
    const resolveCurrent = (frameTime: number, sceneTime: number) =>
      resolveLayers(evaluators.map((evaluator) => evaluator(frameTime, sceneTime)));

    if (!needsFrameUpdates) {
      setLayers(resolveCurrent(0, performance.now() / 1000));
      return undefined;
    }

    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = Math.max(0.001, Math.min(0.1, (now - previousTime) / 1000));
      previousTime = now;
      setLayers(resolveCurrent(deltaSeconds, now / 1000));
      animationFrame = window.requestAnimationFrame(tick);
    };

    setLayers(resolveCurrent(1 / 60, performance.now() / 1000));
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [runtime]);

  return layers;
}

function createLayerEvaluator(layer: WallpaperEngineSceneLayer, runtime: WallpaperEngineSceneRuntime) {
  const originScript = createScriptRunner(layer.dynamicOrigin, runtime);
  const scaleScript = createScriptRunner(layer.dynamicScale, runtime);
  const rotationScript = createScriptRunner(layer.dynamicAngles, runtime);
  const alphaScript = createScriptRunner(layer.dynamicAlpha, runtime);
  const textScript = createScriptRunner(layer.dynamicText, runtime);
  const visibleScript = createScriptRunner(layer.dynamicVisible, runtime);

  return (frametime: number, sceneTime: number): ResolvedLayer => {
    const origin = evaluateVec3Script(originScript, layer.x, layer.y, 0, frametime, sceneTime);
    const scale = evaluateVec3Script(scaleScript, layer.scaleX, layer.scaleY, 1, frametime, sceneTime);
    const rotation = evaluateVec3Script(rotationScript, 0, 0, layer.rotationZDegrees, frametime, sceneTime);
    const alpha = evaluateNumberScript(alphaScript, layer.alpha, frametime, sceneTime);
    const text = evaluateTextScript(textScript, layer.text, frametime, sceneTime);
    const visible = evaluateBooleanScript(visibleScript, layer.visible, frametime, sceneTime);

    return {
      ...layer,
      resolvedX: origin.x,
      resolvedY: origin.y,
      resolvedScaleX: scale.x,
      resolvedScaleY: scale.y,
      resolvedRotationZDegrees: rotation.z,
      resolvedAlpha: alpha,
      resolvedText: text,
      resolvedVisible: visible,
    };
  };
}

function resolveLayers(localLayers: ResolvedLayer[]) {
  const byId = new Map(localLayers.map((layer) => [layer.id, layer]));
  const resolvedById = new Map<number, ResolvedLayer>();
  const resolving = new Set<number>();

  const resolveOne = (layer: ResolvedLayer): ResolvedLayer => {
    const existing = resolvedById.get(layer.id);
    if (existing) return existing;
    if (resolving.has(layer.id)) return layer;
    resolving.add(layer.id);

    const parent = layer.parentId == null ? null : byId.get(layer.parentId) ?? null;
    const resolved = parent ? mergeLayerTransform(resolveOne(parent), layer) : layer;

    resolving.delete(layer.id);
    resolvedById.set(layer.id, resolved);
    return resolved;
  };

  return localLayers.map((layer) => resolveOne(layer));
}

function mergeLayerTransform(parent: ResolvedLayer, layer: ResolvedLayer): ResolvedLayer {
  const scaledOffset = {
    x: layer.resolvedX * parent.resolvedScaleX,
    y: layer.resolvedY * parent.resolvedScaleY,
  };
  const rotatedOffset = rotateVec2(scaledOffset.x, scaledOffset.y, parent.resolvedRotationZDegrees);

  return {
    ...layer,
    resolvedX: parent.resolvedX + rotatedOffset.x,
    resolvedY: parent.resolvedY + rotatedOffset.y,
    resolvedScaleX: layer.resolvedScaleX * parent.resolvedScaleX,
    resolvedScaleY: layer.resolvedScaleY * parent.resolvedScaleY,
    resolvedRotationZDegrees: layer.resolvedRotationZDegrees + parent.resolvedRotationZDegrees,
    resolvedAlpha: layer.resolvedAlpha * parent.resolvedAlpha,
    resolvedVisible: layer.resolvedVisible && parent.resolvedVisible,
  };
}

function rotateVec2(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x: (x * cos) - (y * sin),
    y: (x * sin) + (y * cos),
  };
}

function resolveStaticLayer(layer: WallpaperEngineSceneLayer): ResolvedLayer {
  return {
    ...layer,
    resolvedX: layer.x,
    resolvedY: layer.y,
    resolvedScaleX: layer.scaleX,
    resolvedScaleY: layer.scaleY,
    resolvedRotationZDegrees: layer.rotationZDegrees,
    resolvedAlpha: layer.alpha,
    resolvedText: layer.text,
    resolvedVisible: layer.visible,
  };
}

function createScriptRunner(scriptValue: WallpaperEngineSceneScriptValue | null, runtime: WallpaperEngineSceneRuntime) {
  if (!scriptValue?.script) {
    return null;
  }

  const scriptProperties = unwrapScriptProperties(scriptValue.scriptProperties);
  const engine = createWallpaperEngineScriptEnvironment(runtime);
  const module = compileWallpaperEngineScript(scriptValue.script, engine, scriptProperties);
  const initialValue = cloneScriptValue(scriptValue.value);

  if (module?.init) {
    try {
      module.init(cloneScriptValue(initialValue));
    } catch {
      return null;
    }
  }

  return {
    run(currentValue: unknown, frametime: number, sceneTime: number) {
      if (!module?.update) {
        return currentValue;
      }

      engine.frametime = frametime;
      engine.time = sceneTime;
      engine.audioTime = sceneTime;

      try {
        const inputValue = cloneScriptValue(currentValue);
        const result = module.update(inputValue);
        return typeof result === "undefined" ? inputValue : result;
      } catch {
        return currentValue;
      }
    },
  };
}

function compileWallpaperEngineScript(
  source: string,
  engine: ReturnType<typeof createWallpaperEngineScriptEnvironment>,
  scriptProperties: Record<string, unknown>,
): ScriptModule | null {
  const transformed = source
    .replace(/\bexport\s+function\b/g, "function")
    .replace(/\bexport\s+var\b/g, "var")
    .replace(/\bexport\s+let\b/g, "let")
    .replace(/\bexport\s+const\b/g, "const");

  try {
    const createScriptProperties = () => createScriptPropertiesBuilder(scriptProperties);
    const factory = new Function(
      "engine",
      "createScriptProperties",
      `
${transformed}
return {
  init: typeof init === "function" ? init : undefined,
  update: typeof update === "function" ? update : undefined
};
`,
    ) as (engineValue: typeof engine, createProps: typeof createScriptProperties) => ScriptModule;

    return factory(engine, createScriptProperties);
  } catch {
    return null;
  }
}

function createWallpaperEngineScriptEnvironment(runtime: WallpaperEngineSceneRuntime) {
  return {
    AUDIO_RESOLUTION_16: 16,
    AUDIO_RESOLUTION_32: 32,
    AUDIO_RESOLUTION_64: 64,
    canvasSize: { x: runtime.canvasWidth, y: runtime.canvasHeight, z: 0 },
    frametime: 1 / 60,
    time: 0,
    audioTime: 0,
    registerAudioBuffers(resolution: number) {
      const size = Math.max(1, resolution | 0);
      const createBand = () =>
        Array.from({ length: size }, (_, index) => {
          const progress = index / Math.max(1, size - 1);
          return 0.28 + (Math.sin((progress * 11) + (this.audioTime * 2.2)) * 0.18) + (Math.cos((progress * 7) + (this.audioTime * 3.4)) * 0.08);
        }).map((value) => Math.max(0, Math.min(1, value)));

      return {
        average: createBand(),
        left: createBand(),
        right: createBand(),
      };
    },
  };
}

function createScriptPropertiesBuilder(initialValues: Record<string, unknown>) {
  const values = { ...initialValues };
  const builder = {
    addSlider(config: { name?: string; value?: unknown }) {
      if (config?.name && !(config.name in values)) values[config.name] = config.value ?? 0;
      return builder;
    },
    addCheckbox(config: { name?: string; value?: unknown }) {
      if (config?.name && !(config.name in values)) values[config.name] = config.value ?? false;
      return builder;
    },
    addText(config: { name?: string; value?: unknown }) {
      if (config?.name && !(config.name in values)) values[config.name] = config.value ?? "";
      return builder;
    },
    addCombo(config: { name?: string; value?: unknown; options?: Array<{ value?: unknown }> }) {
      if (config?.name && !(config.name in values)) {
        values[config.name] = config.value ?? config.options?.[0]?.value ?? "";
      }
      return builder;
    },
    addColor(config: { name?: string; value?: unknown }) {
      if (config?.name && !(config.name in values)) values[config.name] = config.value ?? "1 1 1";
      return builder;
    },
    finish() {
      return values;
    },
  };
  return builder;
}

function unwrapScriptProperties(value: Record<string, unknown> | null) {
  const result: Record<string, unknown> = {};
  if (!value) return result;
  for (const [key, entry] of Object.entries(value)) result[key] = unwrapScriptPropertyValue(entry);
  return result;
}

function unwrapScriptPropertyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrapScriptPropertyValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return unwrapScriptPropertyValue(record.value);
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, unwrapScriptPropertyValue(entry)]));
  }
  return value;
}

function cloneScriptValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function evaluateVec3Script(
  runner: ReturnType<typeof createScriptRunner>,
  fallbackX: number,
  fallbackY: number,
  fallbackZ: number,
  frametime: number,
  sceneTime: number,
) {
  const current = { x: fallbackX, y: fallbackY, z: fallbackZ };
  const result = runner?.run(current, frametime, sceneTime);
  return normalizeVec3(result, current);
}

function evaluateTextScript(
  runner: ReturnType<typeof createScriptRunner>,
  fallbackText: string | null,
  frametime: number,
  sceneTime: number,
) {
  const result = runner?.run(fallbackText ?? "", frametime, sceneTime);
  return typeof result === "string" ? result : fallbackText;
}

function evaluateNumberScript(
  runner: ReturnType<typeof createScriptRunner>,
  fallbackValue: number,
  frametime: number,
  sceneTime: number,
) {
  const result = runner?.run(fallbackValue, frametime, sceneTime);
  return typeof result === "number" && Number.isFinite(result) ? result : fallbackValue;
}

function evaluateBooleanScript(
  runner: ReturnType<typeof createScriptRunner>,
  fallbackVisible: boolean,
  frametime: number,
  sceneTime: number,
) {
  const result = runner?.run(fallbackVisible, frametime, sceneTime);
  return typeof result === "boolean" ? result : fallbackVisible;
}

function normalizeVec3(value: unknown, fallback: { x: number; y: number; z: number }) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { x: value, y: value, z: value };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      x: typeof record.x === "number" ? record.x : fallback.x,
      y: typeof record.y === "number" ? record.y : fallback.y,
      z: typeof record.z === "number" ? record.z : fallback.z,
    };
  }
  if (typeof value === "string") {
    const [x, y, z] = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
    return {
      x: Number.isFinite(x) ? x : fallback.x,
      y: Number.isFinite(y) ? y : fallback.y,
      z: Number.isFinite(z) ? z : fallback.z,
    };
  }
  return fallback;
}

function WallpaperEngineSceneLayerNode({
  layer,
  resolvedLayers,
  sceneRootRef,
}: {
  layer: ResolvedLayer;
  resolvedLayers: ResolvedLayer[];
  sceneRootRef: RefObject<HTMLDivElement | null>;
}) {
  const effectStyle = buildEffectStyle(layer.effects);
  const rootStyle: CSSProperties = {
    left: `${layer.resolvedX}px`,
    top: `${layer.resolvedY}px`,
    opacity: `${Math.max(0, Math.min(1, layer.resolvedAlpha))}`,
    display: layer.resolvedVisible ? undefined : "none",
    transform: `rotate(${layer.resolvedRotationZDegrees}deg) scale(${layer.resolvedScaleX}, ${layer.resolvedScaleY})`,
    transformOrigin: "0 0",
  };
  const contentStyle = buildLayerContentStyle(layer, effectStyle);

  const effectOverlays = layer.effects
    .filter((effect) => effect.visible)
    .map((effect, index) =>
      effect.kind === "video" ? (
        <WallpaperEngineSpectrumEffect key={`${layer.id}-${effect.kind}-${index}`} effect={effect} />
      ) : null,
    );

  if (layer.kind === "image" && layer.imagePath) {
    const layerClassName = [
      "wallpaper-engine-scene__layer",
      layer.puppetPath ? "wallpaper-engine-scene__layer--puppet" : "",
    ].filter(Boolean).join(" ");
    // A puppet is a textured MDLV triangle mesh.  It must take precedence over
    // the image-material branches below; otherwise a flowimage material turns
    // the whole puppet back into a rectangular source image.
    if (layer.puppetMesh) {
      return (
        <div className={layerClassName} style={rootStyle} data-layer-id={layer.id}>
          <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
            <WallpaperEnginePuppetMeshLayer layer={layer} mesh={layer.puppetMesh} />
          </div>
        </div>
      );
    }

    if (layer.materialShader === "flowimage" && layer.materialTextures.length >= 2) {
      return (
        <div className={layerClassName} style={rootStyle} data-layer-id={layer.id}>
          <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
            <WallpaperEngineFlowImageLayer layer={layer} />
            {effectOverlays}
          </div>
        </div>
      );
    }

    if (supportsRealtimeImageEffects(layer.effects)) {
      return (
        <div className={layerClassName} style={rootStyle} data-layer-id={layer.id}>
          <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
            <WallpaperEnginePuppetMeshLayer layer={layer} />
          </div>
        </div>
      );
    }

    const mediaSrc = convertFileSrc(layer.imagePath);
    if (isVideoAssetPath(layer.imagePath)) {
      return (
        <div className={layerClassName} style={rootStyle} data-layer-id={layer.id}>
          <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
            <video
              className="wallpaper-engine-scene__image wallpaper-engine-scene__video"
              src={mediaSrc}
              crossOrigin="anonymous"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
            {effectOverlays}
          </div>
        </div>
      );
    }

    return (
      <div className={layerClassName} style={rootStyle} data-layer-id={layer.id}>
        <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
          <img className="wallpaper-engine-scene__image" src={mediaSrc} alt="" crossOrigin="anonymous" />
          {effectOverlays}
        </div>
      </div>
    );
  }

  if (layer.kind === "text") {
    return (
      <div
        className="wallpaper-engine-scene__layer wallpaper-engine-scene__layer--text"
        style={rootStyle}
        data-layer-id={layer.id}
      >
        <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
          <div
            className="wallpaper-engine-scene__text"
            style={{
              color: layer.textColor ?? "#ffffff",
              fontSize: layer.fontSize ? `${layer.fontSize}px` : undefined,
            }}
          >
            {layer.resolvedText}
          </div>
          {effectOverlays}
        </div>
      </div>
    );
  }

  if (layer.kind === "particle") {
    return (
      <div className="wallpaper-engine-scene__layer" style={rootStyle} data-layer-id={layer.id}>
        <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
          <WallpaperEngineParticleLayer layer={layer} />
        </div>
      </div>
    );
  }

  if (layer.kind === "solid" && layer.utilLayerKind && supportsRealtimeUtilityEffects(layer.effects)) {
    return (
      <div className="wallpaper-engine-scene__layer" style={rootStyle} data-layer-id={layer.id}>
        <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
          <WallpaperEngineUtilityEffectLayer
            layer={layer}
            resolvedLayers={resolvedLayers}
            sceneRootRef={sceneRootRef}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="wallpaper-engine-scene__layer" style={rootStyle} data-layer-id={layer.id}>
      <div className="wallpaper-engine-scene__layer-content" style={contentStyle}>
        {effectOverlays}
      </div>
    </div>
  );
}

function WallpaperEngineUtilityEffectLayer({
  layer,
  resolvedLayers,
  sceneRootRef,
}: {
  layer: ResolvedLayer;
  resolvedLayers: ResolvedLayer[];
  sceneRootRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) {
      return;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      return;
    }

    const vertexSource = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}
`;
    const fragmentSource = buildRealtimeEffectFragmentShader();
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      return;
    }

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    if (!positionBuffer || !texCoordBuffer) {
      return;
    }

    const snapshotCanvas = document.createElement("canvas");
    const snapshotContext = snapshotCanvas.getContext("2d", { willReadFrequently: true });
    if (!snapshotContext) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    const effectTextureSources = resolveRealtimeEffectTextureSources(layer);
    const extraTextureSources = effectTextureSources.filter((entry): entry is string => Boolean(entry));

    void Promise.all(
      extraTextureSources.map((src) =>
        fetch(src).then((response) => response.blob()).then((blob) => createImageBitmap(blob)),
      ),
    ).then((extraBitmaps) => {
      if (disposed) {
        extraBitmaps.forEach((entry) => entry.close());
        return;
      }

      const baseTexture = gl.createTexture();
      if (!baseTexture) {
        extraBitmaps.forEach((entry) => entry.close());
        return;
      }

      const renderWidth = Math.max(1, Math.round(layer.width));
      const renderHeight = Math.max(1, Math.round(layer.height));
      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }
      gl.useProgram(program);

      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const positionLocation = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), gl.STATIC_DRAW);
      const texCoordLocation = gl.getAttribLocation(program, "aTexCoord");
      gl.enableVertexAttribArray(texCoordLocation);
      gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);

      extraBitmaps.forEach((entry, index) => {
        const effectTexture = gl.createTexture();
        if (!effectTexture) return;
        gl.activeTexture(gl.TEXTURE1 + index);
        gl.bindTexture(gl.TEXTURE_2D, effectTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry);
      });
      gl.uniform1i(gl.getUniformLocation(program, "uMaskA"), 1);
      gl.uniform1i(gl.getUniformLocation(program, "uMaskB"), 2);
      gl.uniform1i(gl.getUniformLocation(program, "uMaskC"), 3);
      gl.uniform1i(gl.getUniformLocation(program, "uMaskD"), 4);
      gl.uniform1f(gl.getUniformLocation(program, "uHasMaskA"), effectTextureSources[0] ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "uHasMaskB"), effectTextureSources[1] ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "uHasMaskC"), effectTextureSources[2] ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, "uHasMaskD"), effectTextureSources[3] ? 1 : 0);

      const renderFrame = (now: number) => {
        if (disposed) return;
        const root = sceneRootRef.current;
        if (!root) {
          animationFrame = window.requestAnimationFrame(renderFrame);
          return;
        }

        if (!drawSceneSnapshot(snapshotContext, snapshotCanvas, resolvedLayers, layer.id, root)) {
          animationFrame = window.requestAnimationFrame(renderFrame);
          return;
        }
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, baseTexture);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, snapshotCanvas);
        } catch {
          animationFrame = window.requestAnimationFrame(renderFrame);
          return;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(gl.getUniformLocation(program, "uTime"), now / 1000);
        applyEffectUniforms(gl, program, layer);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        animationFrame = window.requestAnimationFrame(renderFrame);
      };

      animationFrame = window.requestAnimationFrame(renderFrame);
      extraBitmaps.forEach((entry) => entry.close());
    }).catch(() => undefined);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
    };
  // The scene resolver creates a new layer object every animation frame. The
  // GL context belongs to this util object, not to that transient object.
  }, [layer.id, sceneRootRef]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__flow-canvas" />;
}

type RuntimeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  size: number;
  rotation: number;
  angularVelocity: number;
  alpha: number;
  baseAlpha: number;
  color: string;
  oscPhase: number;
  oscFrequency: number;
  oscScaleMin: number;
};

function WallpaperEngineParticleLayer({ layer }: { layer: ResolvedLayer }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const texturePath = layer.particleMaterialTextures[0] ?? null;
  const textureSrc = texturePath ? convertFileSrc(texturePath) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !textureSrc || !layer.particleDefinition) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.src = textureSrc;

    const emitter = Array.isArray(layer.particleDefinition.emitter)
      ? layer.particleDefinition.emitter[0] as Record<string, unknown> | undefined
      : undefined;
    const initializers = Array.isArray(layer.particleDefinition.initializer)
      ? layer.particleDefinition.initializer as Record<string, unknown>[]
      : [];
    const operators = Array.isArray(layer.particleDefinition.operator)
      ? layer.particleDefinition.operator as Record<string, unknown>[]
      : [];
    const materialMode = layer.particleMaterialShader?.toLowerCase().includes("particle") ? "particle" : "sprite";
    const instanceOverride = layer.particleInstanceOverride ?? {};
    const alphaMultiplier = readNumericShaderLikeValue(instanceOverride.alpha, 1) * layer.resolvedAlpha;
    const sizeMultiplier = readNumericShaderLikeValue(instanceOverride.size, 1);
    const rateMultiplier = readNumericShaderLikeValue(instanceOverride.rate, 1);
    const lifetimeMultiplier = readNumericShaderLikeValue(instanceOverride.lifetime, 1);
    const speedMultiplier = readNumericShaderLikeValue(instanceOverride.speed, 1);
    const countMultiplier = readNumericShaderLikeValue(instanceOverride.count, 1);
    const maxCount = Math.max(
      1,
      Math.round(readNumericParticleValue(layer.particleDefinition.maxcount, 64) * countMultiplier),
    );
    const particleFlags = layer.particleFlags ?? 0;
    const particles: RuntimeParticle[] = [];
    const random = createDeterministicRandom(layer.id);
    let disposed = false;
    let animationFrame = 0;
    let previousTime = performance.now();
    let emissionCarry = 0;

    const spawnParticle = () => {
      const lifetime = pickInitializerRange(initializers, "lifetimerandom", 1, 3, random) * lifetimeMultiplier;
      const size = pickInitializerRange(initializers, "sizerandom", 12, 36, random) * sizeMultiplier;
      const velocity = pickInitializerVec3(initializers, "velocityrandom", [-24, -24, 0], [24, 24, 0], random);
      const rotation = hasInitializer(initializers, "rotationrandom") ? random() * Math.PI * 2 : 0;
      const angularVelocityRange = pickInitializerVec3(initializers, "angularvelocityrandom", [0, 0, -0.4], [0, 0, 0.4], random);
      const colorValue = pickInitializerColor(initializers, "colorrandom");
      const baseAlpha = alphaMultiplier;

      const point = sampleParticleEmitter(emitter, layer.width, layer.height, particleFlags, random);
      particles.push({
        x: point.x,
        y: point.y,
        vx: velocity[0] * speedMultiplier,
        vy: -velocity[1] * speedMultiplier,
        age: 0,
        lifetime: Math.max(0.001, lifetime),
        size,
        rotation,
        angularVelocity: angularVelocityRange[2],
        alpha: baseAlpha,
        baseAlpha,
        color: colorValue,
        oscPhase: random() * Math.PI * 2,
        oscFrequency: pickOperatorNumber(operators, "oscillatealpha", "frequencymax", 0),
        oscScaleMin: pickOperatorNumber(operators, "oscillatealpha", "scalemin", 1),
      });
      if (particles.length > maxCount) {
        particles.splice(0, particles.length - maxCount);
      }
    };

    const tick = (now: number) => {
      if (disposed) return;
      const dt = Math.min(0.1, Math.max(1 / 120, (now - previousTime) / 1000));
      previousTime = now;

      const rate = readNumericParticleValue(emitter?.rate, 4) * rateMultiplier;
      emissionCarry += rate * dt;
      while (emissionCarry >= 1 && particles.length < maxCount) {
        spawnParticle();
        emissionCarry -= 1;
      }

      const renderWidth = Math.max(1, Math.round(layer.width));
      const renderHeight = Math.max(1, Math.round(layer.height));
      if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
        canvas.width = renderWidth;
        canvas.height = renderHeight;
      }

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = materialMode === "particle" ? "lighter" : "source-over";

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.age += dt;
        if (particle.age >= particle.lifetime) {
          particles.splice(index, 1);
          continue;
        }

        const life = particle.age / particle.lifetime;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.rotation += particle.angularVelocity * dt;

        if (hasOperator(operators, "movement")) {
          const gravity = pickOperatorVec3(operators, "movement", "gravity", [0, 0, 0]);
          particle.vx += gravity[0] * dt;
          particle.vy += -gravity[1] * dt;
        }

        if (hasOperator(operators, "turbulence")) {
          const turbulence = pickOperatorNumber(operators, "turbulence", "speedmax", 0);
          particle.vx += (random() - 0.5) * turbulence * 0.02 * dt;
          particle.vy += (random() - 0.5) * turbulence * 0.02 * dt;
        }

        let alpha = particle.baseAlpha;
        const alphaFade = operators.find((entry) => String(entry.name ?? "") === "alphafade");
        if (alphaFade) {
          const fadeIn = readNumericParticleValue(alphaFade.fadeintime, 0);
          const fadeOut = readNumericParticleValue(alphaFade.fadeouttime, 1);
          if (life < fadeIn && fadeIn > 0) {
            alpha *= life / fadeIn;
          } else if (life > fadeOut && fadeOut < 1) {
            alpha *= Math.max(0, 1 - ((life - fadeOut) / Math.max(0.001, 1 - fadeOut)));
          }
        }

        if (particle.oscFrequency > 0) {
          const osc = (Math.sin((now / 1000 * particle.oscFrequency) + particle.oscPhase) * 0.5) + 0.5;
          alpha *= particle.oscScaleMin + ((1 - particle.oscScaleMin) * osc);
        }

        context.save();
        context.translate((canvas.width / 2) + particle.x, (canvas.height / 2) - particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = Math.max(0, Math.min(1, alpha));
        context.filter = materialMode === "particle" ? "brightness(1.2)" : "none";
        if (image.complete) {
          context.drawImage(image, -(particle.size / 2), -(particle.size / 2), particle.size, particle.size);
        } else {
          context.fillStyle = particle.color;
          context.beginPath();
          context.arc(0, 0, particle.size / 2, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    image.onload = () => {
      animationFrame = window.requestAnimationFrame(tick);
    };
    if (image.complete) {
      animationFrame = window.requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [layer]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__flow-canvas" />;
}

function buildLayerContentStyle(layer: ResolvedLayer, effectStyle: CSSProperties): CSSProperties {
  const width = Math.max(1, layer.width);
  const height = Math.max(1, layer.height);
  const anchor = resolveAnchorOffset(layer.anchor, width, height);

  return {
    position: "absolute",
    left: `${anchor.x + layer.modelCropOffsetX}px`,
    top: `${anchor.y + layer.modelCropOffsetY}px`,
    width: `${width}px`,
    height: `${height}px`,
    ...effectStyle,
  };
}

function resolveAnchorOffset(anchor: string | null, width: number, height: number) {
  const normalized = (anchor ?? "none").trim().toLowerCase();
  if (normalized === "top-left" || normalized === "left-top") {
    return { x: 0, y: 0 };
  }
  if (normalized === "top-center" || normalized === "center-top") {
    return { x: -(width / 2), y: 0 };
  }
  if (normalized === "top-right" || normalized === "right-top") {
    return { x: -width, y: 0 };
  }
  if (normalized === "center-left" || normalized === "left-center") {
    return { x: 0, y: -(height / 2) };
  }
  if (normalized === "center-right" || normalized === "right-center") {
    return { x: -width, y: -(height / 2) };
  }
  if (normalized === "bottom-left" || normalized === "left-bottom") {
    return { x: 0, y: -height };
  }
  if (normalized === "bottom-center" || normalized === "center-bottom") {
    return { x: -(width / 2), y: -height };
  }
  if (normalized === "bottom-right" || normalized === "right-bottom") {
    return { x: -width, y: -height };
  }

  return { x: -(width / 2), y: -(height / 2) };
}

function drawSceneSnapshot(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  resolvedLayers: ResolvedLayer[],
  untilLayerId: number,
  sceneRoot: HTMLDivElement,
) {
  const sceneCanvas = sceneRoot.querySelector(".wallpaper-engine-scene__canvas") as HTMLDivElement | null;
  if (!sceneCanvas) {
    return false;
  }

  const canvasWidth = Math.max(1, Math.round(sceneCanvas.clientWidth));
  const canvasHeight = Math.max(1, Math.round(sceneCanvas.clientHeight));
  if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const layer of resolvedLayers) {
    if (layer.id === untilLayerId) {
      break;
    }
    if (!layer.resolvedVisible || layer.resolvedAlpha <= 0) {
      continue;
    }
    if (layer.kind === "solid" && layer.utilLayerKind) {
      continue;
    }

    const host = sceneRoot.querySelector(`[data-layer-id="${layer.id}"]`) as HTMLElement | null;
    if (!host) {
      continue;
    }

    context.save();
    context.translate(layer.resolvedX, layer.resolvedY);
    context.rotate((layer.resolvedRotationZDegrees * Math.PI) / 180);
    context.scale(layer.resolvedScaleX, layer.resolvedScaleY);
    context.globalAlpha = Math.max(0, Math.min(1, layer.resolvedAlpha));

    const anchor = resolveAnchorOffset(layer.anchor, Math.max(1, layer.width), Math.max(1, layer.height));
    const drawX = anchor.x + layer.modelCropOffsetX;
    const drawY = anchor.y + layer.modelCropOffsetY;
    const drawWidth = Math.max(1, layer.width);
    const drawHeight = Math.max(1, layer.height);

    if (layer.kind === "text" && layer.resolvedText) {
      context.fillStyle = layer.textColor ?? "#ffffff";
      context.font = `${layer.fontSize ?? 48}px sans-serif`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(layer.resolvedText, drawX + (drawWidth / 2), drawY + (drawHeight / 2), drawWidth);
      context.restore();
      continue;
    }

    const source =
      host.querySelector("canvas") as HTMLCanvasElement | null
      ?? host.querySelector("video") as HTMLVideoElement | null
      ?? host.querySelector("img") as HTMLImageElement | null;
    if (source) {
      try {
        context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
      } catch {
        // ignore transient drawImage errors from media elements
      }
    }

    context.restore();
  }

  try {
    context.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    context.clearRect(0, 0, canvas.width, canvas.height);
    return false;
  }
}

function buildEffectStyle(effects: WallpaperEngineSceneEffect[]) {
  const style: CSSProperties = {};
  const filters: string[] = [];

  for (const effect of effects) {
    if (!effect.visible) continue;

    if (effect.kind === "opacity" || effect.kind === "blur_precise") {
      const maskPath = effect.texturePaths.find(Boolean);
      if (maskPath) {
        const maskSrc = `url("${convertFileSrc(maskPath)}")`;
        style.maskImage = maskSrc;
        style.maskRepeat = "no-repeat";
        style.maskSize = "100% 100%";
        style.maskPosition = "center";
        style.WebkitMaskImage = maskSrc;
        style.WebkitMaskRepeat = "no-repeat";
        style.WebkitMaskSize = "100% 100%";
        style.WebkitMaskPosition = "center";
      }
    }

    if (effect.kind === "blur_precise") {
      const scaleValue = typeof effect.constantShaderValues?.scale === "string"
        ? effect.constantShaderValues.scale
        : null;
      const scaleParts = scaleValue?.split(/\s+/).map((part) => Number.parseFloat(part)) ?? [1, 1];
      const blurStrength = Math.max(scaleParts[0] ?? 1, scaleParts[1] ?? 1);
      filters.push(`blur(${Math.max(0, (blurStrength - 1) * 18).toFixed(2)}px)`);
    }
  }

  if (filters.length > 0) style.filter = filters.join(" ");
  return style;
}

function supportsRealtimeImageEffects(effects: WallpaperEngineSceneEffect[]) {
  return effects.some((effect) =>
    ["perspective", "waterflow", "waterripple", "waterwaves", "shake", "iris", "blur", "shine"].includes(effect.kind),
  );
}

function supportsRealtimeUtilityEffects(effects: WallpaperEngineSceneEffect[]) {
  return supportsRealtimeImageEffects(effects);
}

function buildRealtimeEffectFragmentShader() {
  return `
precision mediump float;
uniform sampler2D uTexture;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uMaskC;
uniform sampler2D uMaskD;
uniform float uHasMaskA;
uniform float uHasMaskB;
uniform float uHasMaskC;
uniform float uHasMaskD;
uniform float uTime;
uniform vec4 uPerspective;
uniform vec3 uWaterflow;
uniform vec4 uWaterripple;
uniform vec4 uWaterwaves;
uniform vec4 uShake;
uniform vec4 uIris;
uniform vec4 uBlur;
uniform vec4 uShine;
varying vec2 vTexCoord;
vec2 applyPerspective(vec2 uv) {
  vec2 centered = uv - 0.5;
  centered.x *= 0.5 / (0.5 - mix(uPerspective.x, uPerspective.y, step(0.5, uv.y)));
  centered.y *= 0.5 / (0.5 - mix(uPerspective.z, uPerspective.w, step(0.5, uv.x)));
  return centered + 0.5;
}
void main() {
  vec2 uv = vTexCoord;
  if (uPerspective != vec4(0.0)) {
    uv = applyPerspective(uv);
  }

  vec4 color = texture2D(uTexture, uv);

  if (uHasMaskA > 0.5 || uHasMaskB > 0.5 || uHasMaskC > 0.5) {
    vec2 flowMask = uHasMaskA > 0.5 ? ((texture2D(uMaskA, uv).rg - vec2(0.498, 0.498)) * 2.0) : vec2(0.0);
    float flowPhase = uHasMaskB > 0.5 ? texture2D(uMaskB, uv * max(0.01, uWaterflow.z)).r : 0.0;
    float flowAmount = length(flowMask);
    vec4 cycles = vec4(fract(uTime * uWaterflow.x), fract(uTime * uWaterflow.x + 0.5), fract(0.25 + uTime * uWaterflow.x), fract(0.25 + uTime * uWaterflow.x + 0.5));
    float blend = 2.0 * abs(cycles.x - 0.5);
    float blend2 = 2.0 * abs(cycles.z - 0.5);
    cycles -= vec4(0.5);
    vec4 flowUVOffset = vec4(flowMask.xyxy * uWaterflow.y * 0.1) * cycles.xxyy;
    vec4 flowUVOffset2 = vec4(flowMask.xyxy * uWaterflow.y * 0.1) * cycles.zzww;
    vec4 flowA = mix(texture2D(uTexture, uv + flowUVOffset.xy), texture2D(uTexture, uv + flowUVOffset.zw), blend);
    vec4 flowB = mix(texture2D(uTexture, uv + flowUVOffset2.xy), texture2D(uTexture, uv + flowUVOffset2.zw), blend2);
    color = mix(color, mix(flowA, flowB, smoothstep(0.2, 0.8, flowPhase)), clamp(flowAmount, 0.0, 1.0));

    vec4 rippleCoords = vec4(
      uv + (uTime * uWaterripple.x * uWaterripple.x),
      (uv * 1.333) - (uTime * uWaterripple.x * uWaterripple.x)
    ) * max(0.01, uWaterripple.y);
    vec3 n1 = uHasMaskC > 0.5 ? texture2D(uMaskC, rippleCoords.xy).xyz * 2.0 - 1.0 : vec3(0.5, 0.5, 1.0);
    vec3 n2 = uHasMaskC > 0.5 ? texture2D(uMaskC, rippleCoords.zw).xyz * 2.0 - 1.0 : vec3(0.5, 0.5, 1.0);
    vec3 normal = normalize(vec3(n1.xy + n2.xy, max(n1.z, 0.0001)));
    color = texture2D(uTexture, uv + normal.xy * uWaterripple.z * uWaterripple.z);

    vec2 waveDir = vec2(cos(uWaterwaves.w), sin(uWaterwaves.w));
    float distanceA = (uTime * uWaterwaves.x) + dot(uv, waveDir) * uWaterwaves.y;
    float valA = pow(abs(sin(distanceA)), max(0.51, uWaterwaves.z));
    float sA = sign(sin(distanceA));
    vec2 waveOffset = vec2(waveDir.y, -waveDir.x) * valA * sA * 0.01;
    color = texture2D(uTexture, uv + waveOffset);

    float shakeBase = sin(uShake.x * uTime) * 0.498 + 0.5;
    float shakeAmount = clamp((shakeBase - uShake.z) * uShake.w, 0.0, 1.0);
    color = texture2D(uTexture, uv + flowMask * shakeAmount * uShake.y * uShake.y);

    vec2 irisOffset = vec2(sin(uTime * uIris.y + uIris.w), cos(uTime * uIris.y + uIris.w)) * uIris.x * 0.001;
    color = texture2D(uTexture, uv + irisOffset);
  }

  if (uBlur.x > 0.0) {
    vec2 blurStep = vec2(uBlur.x / 1024.0, uBlur.y / 1024.0);
    vec4 blurred = vec4(0.0);
    blurred += texture2D(uTexture, uv - blurStep * 2.0) * 0.12162162;
    blurred += texture2D(uTexture, uv - blurStep) * 0.23324324;
    blurred += texture2D(uTexture, uv) * 0.29027027;
    blurred += texture2D(uTexture, uv + blurStep) * 0.23324324;
    blurred += texture2D(uTexture, uv + blurStep * 2.0) * 0.12162162;
    float blurMask = uHasMaskD > 0.5 ? texture2D(uMaskD, uv).r : 1.0;
    color = mix(color, blurred, blurMask * uBlur.z);
  }

  if (uShine.x > 0.0) {
    vec2 rayDir = vec2(cos(uShine.x), sin(uShine.x)) * (0.03 + (uShine.y * 0.08));
    vec4 rays = vec4(0.0);
    rays += texture2D(uTexture, uv + rayDir * 1.0) * 0.30;
    rays += texture2D(uTexture, uv + rayDir * 2.0) * 0.22;
    rays += texture2D(uTexture, uv + rayDir * 3.0) * 0.16;
    rays += texture2D(uTexture, uv - rayDir * 1.0) * 0.18;
    rays += texture2D(uTexture, uv - rayDir * 2.0) * 0.14;
    color.rgb = mix(color.rgb, color.rgb + (rays.rgb * uShine.z), clamp(uShine.w, 0.0, 1.0));
    color.a = max(color.a, rays.a * uShine.w);
  }

  gl_FragColor = color;
}
`;
}

function WallpaperEnginePuppetMeshLayer({
  layer,
  mesh,
}: {
  layer: ResolvedLayer;
  mesh?: WallpaperEngineScenePuppetMesh | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageSrc = layer.imagePath ? convertFileSrc(layer.imagePath) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSrc) {
      return;
    }

    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
    if (!gl) {
      return;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      return;
    }

    const vertexSource = mesh ? `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
uniform vec2 uCanvasSize;
varying vec2 vTexCoord;
void main() {
  vec2 clip = vec2(
    (aPosition.x / uCanvasSize.x) * 2.0 - 1.0,
    1.0 - (aPosition.y / uCanvasSize.y) * 2.0
  );
  gl_Position = vec4(clip, aPosition.z, 1.0);
  vTexCoord = aTexCoord;
}
` : `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}
`;
    const fragmentSource = `
precision mediump float;
uniform sampler2D uTexture;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uMaskC;
uniform sampler2D uMaskD;
uniform float uHasMaskA;
uniform float uHasMaskB;
uniform float uHasMaskC;
uniform float uHasMaskD;
uniform float uTime;
uniform vec4 uPerspective;
uniform vec3 uWaterflow;
uniform vec4 uWaterripple;
uniform vec4 uWaterwaves;
uniform vec4 uShake;
uniform vec4 uIris;
uniform vec4 uBlur;
uniform vec4 uShine;
varying vec2 vTexCoord;
vec2 applyPerspective(vec2 uv) {
  vec2 centered = uv - 0.5;
  centered.x *= 0.5 / (0.5 - mix(uPerspective.x, uPerspective.y, step(0.5, uv.y)));
  centered.y *= 0.5 / (0.5 - mix(uPerspective.z, uPerspective.w, step(0.5, uv.x)));
  return centered + 0.5;
}
void main() {
  vec2 uv = vTexCoord;
  if (uPerspective != vec4(0.0)) {
    uv = applyPerspective(uv);
  }

  vec4 color = texture2D(uTexture, uv);

  if (uHasMaskA > 0.5 || uHasMaskB > 0.5 || uHasMaskC > 0.5) {
    vec2 flowMask = uHasMaskA > 0.5 ? ((texture2D(uMaskA, uv).rg - vec2(0.498, 0.498)) * 2.0) : vec2(0.0);
    float flowPhase = uHasMaskB > 0.5 ? texture2D(uMaskB, uv * max(0.01, uWaterflow.z)).r : 0.0;
    float flowAmount = length(flowMask);
    vec4 cycles = vec4(fract(uTime * uWaterflow.x), fract(uTime * uWaterflow.x + 0.5), fract(0.25 + uTime * uWaterflow.x), fract(0.25 + uTime * uWaterflow.x + 0.5));
    float blend = 2.0 * abs(cycles.x - 0.5);
    float blend2 = 2.0 * abs(cycles.z - 0.5);
    cycles -= vec4(0.5);
    vec4 flowUVOffset = vec4(flowMask.xyxy * uWaterflow.y * 0.1) * cycles.xxyy;
    vec4 flowUVOffset2 = vec4(flowMask.xyxy * uWaterflow.y * 0.1) * cycles.zzww;
    vec4 flowA = mix(texture2D(uTexture, uv + flowUVOffset.xy), texture2D(uTexture, uv + flowUVOffset.zw), blend);
    vec4 flowB = mix(texture2D(uTexture, uv + flowUVOffset2.xy), texture2D(uTexture, uv + flowUVOffset2.zw), blend2);
    color = mix(color, mix(flowA, flowB, smoothstep(0.2, 0.8, flowPhase)), clamp(flowAmount, 0.0, 1.0));

    vec4 rippleCoords = vec4(
      uv + (uTime * uWaterripple.x * uWaterripple.x),
      (uv * 1.333) - (uTime * uWaterripple.x * uWaterripple.x)
    ) * max(0.01, uWaterripple.y);
    vec3 n1 = uHasMaskC > 0.5 ? texture2D(uMaskC, rippleCoords.xy).xyz * 2.0 - 1.0 : vec3(0.5, 0.5, 1.0);
    vec3 n2 = uHasMaskC > 0.5 ? texture2D(uMaskC, rippleCoords.zw).xyz * 2.0 - 1.0 : vec3(0.5, 0.5, 1.0);
    vec3 normal = normalize(vec3(n1.xy + n2.xy, max(n1.z, 0.0001)));
    color = texture2D(uTexture, uv + normal.xy * uWaterripple.z * uWaterripple.z);

    vec2 waveDir = vec2(cos(uWaterwaves.w), sin(uWaterwaves.w));
    float distanceA = (uTime * uWaterwaves.x) + dot(uv, waveDir) * uWaterwaves.y;
    float valA = pow(abs(sin(distanceA)), max(0.51, uWaterwaves.z));
    float sA = sign(sin(distanceA));
    vec2 waveOffset = vec2(waveDir.y, -waveDir.x) * valA * sA * 0.01;
    color = texture2D(uTexture, uv + waveOffset);

    float shakeBase = sin(uShake.x * uTime) * 0.498 + 0.5;
    float shakeAmount = clamp((shakeBase - uShake.z) * uShake.w, 0.0, 1.0);
    color = texture2D(uTexture, uv + flowMask * shakeAmount * uShake.y * uShake.y);

    vec2 irisOffset = vec2(sin(uTime * uIris.y + uIris.w), cos(uTime * uIris.y + uIris.w)) * uIris.x * 0.001;
    color = texture2D(uTexture, uv + irisOffset);
  }

  if (uBlur.x > 0.0) {
    vec2 blurStep = vec2(uBlur.x / 1024.0, uBlur.y / 1024.0);
    vec4 blurred = vec4(0.0);
    blurred += texture2D(uTexture, uv - blurStep * 2.0) * 0.12162162;
    blurred += texture2D(uTexture, uv - blurStep) * 0.23324324;
    blurred += texture2D(uTexture, uv) * 0.29027027;
    blurred += texture2D(uTexture, uv + blurStep) * 0.23324324;
    blurred += texture2D(uTexture, uv + blurStep * 2.0) * 0.12162162;
    float blurMask = uHasMaskD > 0.5 ? texture2D(uMaskD, uv).r : 1.0;
    color = mix(color, blurred, blurMask * uBlur.z);
  }

  if (uShine.x > 0.0) {
    vec2 rayDir = vec2(cos(uShine.x), sin(uShine.x)) * (0.03 + (uShine.y * 0.08));
    vec4 rays = vec4(0.0);
    rays += texture2D(uTexture, uv + rayDir * 1.0) * 0.30;
    rays += texture2D(uTexture, uv + rayDir * 2.0) * 0.22;
    rays += texture2D(uTexture, uv + rayDir * 3.0) * 0.16;
    rays += texture2D(uTexture, uv - rayDir * 1.0) * 0.18;
    rays += texture2D(uTexture, uv - rayDir * 2.0) * 0.14;
    color.rgb = mix(color.rgb, color.rgb + (rays.rgb * uShine.z), clamp(uShine.w, 0.0, 1.0));
    color.a = max(color.a, rays.a * uShine.w);
  }

  gl_FragColor = color;
}
`;

    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      return;
    }

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }

    const positionBuffer = gl.createBuffer();
    const texCoordBuffer = gl.createBuffer();
    const indexBuffer = mesh ? gl.createBuffer() : null;
    if (!positionBuffer || !texCoordBuffer || (mesh && !indexBuffer)) {
      return;
    }

    let disposed = false;
    let animationFrame = 0;
    let texture: WebGLTexture | null = null;
    const effectTextures: WebGLTexture[] = [];
    const effectTextureSources = resolveRealtimeEffectTextureSources(layer);
    const extraTextureSources = effectTextureSources.filter((entry): entry is string => Boolean(entry));

    void Promise.all(
      [imageSrc, ...extraTextureSources].map((src) =>
        fetch(src).then((response) => response.blob()).then((blob) => createImageBitmap(blob)),
      ),
    ).then(([bitmap, ...extraBitmaps]) => {
        if (disposed) {
          bitmap.close();
          extraBitmaps.forEach((entry) => entry.close());
          return;
        }

        texture = gl.createTexture();
        if (!texture) {
          bitmap.close();
          extraBitmaps.forEach((entry) => entry.close());
          return;
        }

        const renderWidth = Math.max(1, Math.round(layer.width));
        const renderHeight = Math.max(1, Math.round(layer.height));
        if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
          canvas.width = renderWidth;
          canvas.height = renderHeight;
        }
        gl.useProgram(program);

        const positionLocation = gl.getAttribLocation(program, "aPosition");
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          mesh
            // Keep the MDLV bind pose exactly as CImage does in the reference
            // renderer.  MDLS matrices are bind-pose data, not parent/bind
            // coordinates, so applying the incomplete MDLA decoder here
            // corrupts weighted vertices and drops pieces of a puppet.
            ? new Float32Array(mesh.positions)
            : new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, mesh ? 3 : 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          mesh
            ? new Float32Array(mesh.texCoords)
            : new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]),
          gl.STATIC_DRAW,
        );
        const texCoordLocation = gl.getAttribLocation(program, "aTexCoord");
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        if (mesh && indexBuffer) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
        }

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
        extraBitmaps.forEach((entry, index) => {
          const effectTexture = gl.createTexture();
          if (!effectTexture) return;
          effectTextures.push(effectTexture);
          gl.activeTexture(gl.TEXTURE1 + index);
          gl.bindTexture(gl.TEXTURE_2D, effectTexture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry);
        });
        gl.uniform1i(gl.getUniformLocation(program, "uMaskA"), 1);
        gl.uniform1i(gl.getUniformLocation(program, "uMaskB"), 2);
        gl.uniform1i(gl.getUniformLocation(program, "uMaskC"), 3);
        gl.uniform1i(gl.getUniformLocation(program, "uMaskD"), 4);
        gl.uniform1f(gl.getUniformLocation(program, "uHasMaskA"), effectTextureSources[0] ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(program, "uHasMaskB"), effectTextureSources[1] ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(program, "uHasMaskC"), effectTextureSources[2] ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(program, "uHasMaskD"), effectTextureSources[3] ? 1 : 0);

        const renderFrame = (now: number) => {
          if (disposed) {
            return;
          }
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(program);
          gl.uniform1f(gl.getUniformLocation(program, "uTime"), now / 1000);
          applyEffectUniforms(gl, program, layer);
          if (mesh && indexBuffer) {
            gl.uniform2f(gl.getUniformLocation(program, "uCanvasSize"), renderWidth, renderHeight);
            gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
          } else {
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
          animationFrame = window.requestAnimationFrame(renderFrame);
        };

        animationFrame = window.requestAnimationFrame(renderFrame);

        bitmap.close();
        extraBitmaps.forEach((entry) => entry.close());
      }).catch(() => undefined);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      if (texture) gl.deleteTexture(texture);
      effectTextures.forEach((entry) => gl.deleteTexture(entry));
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(texCoordBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [imageSrc, layer.height, layer.width, mesh]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__flow-canvas" />;
}

function applyEffectUniforms(gl: WebGLRenderingContext, program: WebGLProgram, layer: ResolvedLayer) {
  const perspective = layer.effects.find((effect) => effect.kind === "perspective");
  const waterflow = layer.effects.find((effect) => effect.kind === "waterflow");
  const waterripple = layer.effects.find((effect) => effect.kind === "waterripple");
  const waterwaves = layer.effects.find((effect) => effect.kind === "waterwaves");
  const shake = layer.effects.find((effect) => effect.kind === "shake");
  const iris = layer.effects.find((effect) => effect.kind === "iris");
  const blurEffects = layer.effects.filter((effect) => effect.kind === "blur" || effect.kind === "blur_precise");
  const shineEffects = layer.effects.filter((effect) => effect.kind === "shine");

  const bounds = parseVec2Value(shake?.constantShaderValues?.bounds);
  const blurScale = parseVec2Value(blurEffects.find((effect) => typeof effect.constantShaderValues?.scale === "string")?.constantShaderValues?.scale);
  const shineDirection = readNumericShaderValue(shineEffects.find((effect) => effect.constantShaderValues?.direction != null)?.constantShaderValues?.direction);
  const shineIntensity = readNumericShaderValue(shineEffects.find((effect) => effect.constantShaderValues?.rayintensity != null)?.constantShaderValues?.rayintensity);
  const shineLength = readNumericShaderValue(shineEffects.find((effect) => effect.constantShaderValues?.raylength != null)?.constantShaderValues?.raylength);
  const shineMix = shineEffects.length > 0 ? 1 : 0;

  gl.uniform4f(
    gl.getUniformLocation(program, "uPerspective"),
    readNumericShaderValue(perspective?.constantShaderValues?.top),
    readNumericShaderValue(perspective?.constantShaderValues?.bottom),
    readNumericShaderValue(perspective?.constantShaderValues?.left),
    readNumericShaderValue(perspective?.constantShaderValues?.right),
  );
  gl.uniform3f(
    gl.getUniformLocation(program, "uWaterflow"),
    readNumericShaderValue(waterflow?.constantShaderValues?.speed),
    readNumericShaderValue(waterflow?.constantShaderValues?.strength),
    readNumericShaderValue(waterflow?.constantShaderValues?.phasescale, 1),
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uWaterripple"),
    readNumericShaderValue(waterripple?.constantShaderValues?.animationspeed),
    readNumericShaderValue(waterripple?.constantShaderValues?.scale, 1),
    readNumericShaderValue(waterripple?.constantShaderValues?.ripplestrength),
    readNumericShaderValue(waterripple?.constantShaderValues?.scrolldirection),
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uWaterwaves"),
    readNumericShaderValue(waterwaves?.constantShaderValues?.speed),
    readNumericShaderValue(waterwaves?.constantShaderValues?.scale),
    readNumericShaderValue(waterwaves?.constantShaderValues?.exponent, 1),
    readNumericShaderValue(waterwaves?.constantShaderValues?.direction),
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uShake"),
    readNumericShaderValue(shake?.constantShaderValues?.speed, 1),
    readNumericShaderValue(shake?.constantShaderValues?.strength),
    bounds[0],
    1 / Math.max(0.0001, bounds[1] - bounds[0]),
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uIris"),
    readNumericShaderValue(iris?.constantShaderValues?.noiseamount),
    readNumericShaderValue(iris?.constantShaderValues?.speed, 1),
    readNumericShaderValue(iris?.constantShaderValues?.rough),
    readNumericShaderValue(iris?.constantShaderValues?.phase),
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uBlur"),
    blurScale[0],
    blurScale[1],
    blurEffects.length > 0 ? 1 : 0,
    0,
  );
  gl.uniform4f(
    gl.getUniformLocation(program, "uShine"),
    shineDirection,
    shineLength,
    shineIntensity,
    shineMix,
  );
}

function resolveRealtimeEffectTextureSources(layer: ResolvedLayer) {
  const waterflow = layer.effects.find((effect) => effect.kind === "waterflow");
  const waterripple = layer.effects.find((effect) => effect.kind === "waterripple");
  const waterwaves = layer.effects.find((effect) => effect.kind === "waterwaves");
  const shake = layer.effects.find((effect) => effect.kind === "shake");
  const iris = layer.effects.find((effect) => effect.kind === "iris");
  const blur = layer.effects.find((effect) => effect.kind === "blur" || effect.kind === "blur_precise");

  const maskA =
    waterflow?.texturePaths.find(Boolean)
    ?? waterwaves?.texturePaths.find(Boolean)
    ?? shake?.texturePaths.find(Boolean)
    ?? iris?.texturePaths.find(Boolean)
    ?? null;
  const maskB =
    waterflow?.texturePaths.filter(Boolean)[1]
    ?? waterripple?.texturePaths.find(Boolean)
    ?? shake?.texturePaths.filter(Boolean)[1]
    ?? null;
  const waterrippleTextures = waterripple?.texturePaths.filter(Boolean) ?? [];
  const shakeTextures = shake?.texturePaths.filter(Boolean) ?? [];
  const maskC =
    (waterrippleTextures.length > 0 ? waterrippleTextures[waterrippleTextures.length - 1] : null)
    ?? (shakeTextures.length > 0 ? shakeTextures[shakeTextures.length - 1] : null)
    ?? null;
  const maskD = blur?.texturePaths.find(Boolean) ?? null;

  return [maskA, maskB, maskC, maskD].map((entry) => (entry ? convertFileSrc(entry) : null));
}

function readNumericShaderValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return readNumericShaderValue((value as Record<string, unknown>).value, fallback);
  }
  return fallback;
}

function parseVec2Value(value: unknown) {
  const raw =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "value" in (value as Record<string, unknown>)
        ? String((value as Record<string, unknown>).value ?? "0 1")
        : "0 1";
  const [x, y] = raw.split(/\s+/).map((part) => Number.parseFloat(part));
  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 1];
}

function createDeterministicRandom(seed: number) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 0x100000000) / 0x100000000;
  };
}

function readNumericShaderLikeValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return readNumericShaderLikeValue((value as Record<string, unknown>).value, fallback);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readNumericParticleValue(value: unknown, fallback = 0) {
  return readNumericShaderLikeValue(value, fallback);
}

function readVec3ParticleValue(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (typeof value === "string") {
    const parts = value.split(/\s+/).map((part) => Number.parseFloat(part));
    return [
      Number.isFinite(parts[0]) ? parts[0] : fallback[0],
      Number.isFinite(parts[1]) ? parts[1] : fallback[1],
      Number.isFinite(parts[2]) ? parts[2] : fallback[2],
    ];
  }
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return readVec3ParticleValue((value as Record<string, unknown>).value, fallback);
  }
  return fallback;
}

function hasInitializer(initializers: Record<string, unknown>[], name: string) {
  return initializers.some((entry) => String(entry.name ?? "") === name);
}

function hasOperator(operators: Record<string, unknown>[], name: string) {
  return operators.some((entry) => String(entry.name ?? "") === name);
}

function pickInitializerRange(
  initializers: Record<string, unknown>[],
  name: string,
  fallbackMin: number,
  fallbackMax: number,
  random: () => number,
) {
  const entry = initializers.find((candidate) => String(candidate.name ?? "") === name);
  const min = readNumericParticleValue(entry?.min, fallbackMin);
  const max = readNumericParticleValue(entry?.max, fallbackMax);
  return min + ((max - min) * random());
}

function pickInitializerVec3(
  initializers: Record<string, unknown>[],
  name: string,
  fallbackMin: [number, number, number],
  fallbackMax: [number, number, number],
  random: () => number,
) {
  const entry = initializers.find((candidate) => String(candidate.name ?? "") === name);
  const min = readVec3ParticleValue(entry?.min, fallbackMin);
  const max = readVec3ParticleValue(entry?.max, fallbackMax);
  return [
    min[0] + ((max[0] - min[0]) * random()),
    min[1] + ((max[1] - min[1]) * random()),
    min[2] + ((max[2] - min[2]) * random()),
  ] as [number, number, number];
}

function pickInitializerColor(initializers: Record<string, unknown>[], name: string) {
  const entry = initializers.find((candidate) => String(candidate.name ?? "") === name);
  const min = readVec3ParticleValue(entry?.min ?? entry?.max, [255, 255, 255]);
  const [r, g, b] = min.map((value) => Math.max(0, Math.min(255, value)));
  return `rgb(${r}, ${g}, ${b})`;
}

function pickOperatorNumber(
  operators: Record<string, unknown>[],
  name: string,
  key: string,
  fallback: number,
) {
  const entry = operators.find((candidate) => String(candidate.name ?? "") === name) as Record<string, unknown> | undefined;
  return readNumericParticleValue(entry?.[key], fallback);
}

function pickOperatorVec3(
  operators: Record<string, unknown>[],
  name: string,
  key: string,
  fallback: [number, number, number],
) {
  const entry = operators.find((candidate) => String(candidate.name ?? "") === name) as Record<string, unknown> | undefined;
  return readVec3ParticleValue(entry?.[key], fallback);
}

function sampleParticleEmitter(
  emitter: Record<string, unknown> | undefined,
  width: number,
  height: number,
  particleFlags: number,
  random: () => number,
) {
  const emitterName = String(emitter?.name ?? "boxrandom");
  const origin = readVec3ParticleValue(emitter?.origin, [0, 0, 0]);
  if (emitterName === "sphererandom") {
    const maxDistance = readNumericParticleValue(emitter?.distancemax, Math.max(width, height) * 0.25);
    const minDistance = readNumericParticleValue(emitter?.distancemin, 0);
    const radius = minDistance + ((maxDistance - minDistance) * Math.sqrt(random()));
    const angle = random() * Math.PI * 2;
    const yScale = (particleFlags & 4) !== 0 ? 1 : 0.35;
    return {
      x: origin[0] + (Math.cos(angle) * radius),
      y: origin[1] + (Math.sin(angle) * radius * yScale),
    };
  }

  const dist = readVec3ParticleValue(emitter?.distancemax, [width / 2, height / 2, 0]);
  return {
    x: origin[0] + ((random() - 0.5) * dist[0]),
    y: origin[1] + ((random() - 0.5) * dist[1]),
  };
}

function WallpaperEngineFlowImageLayer({ layer }: { layer: ResolvedLayer }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseTexturePath = layer.materialTextures[0] ?? layer.imagePath;
  const flowTexturePath = layer.materialTextures[1] ?? null;
  const baseSrc = baseTexturePath ? convertFileSrc(baseTexturePath) : null;
  const flowSrc = flowTexturePath ? convertFileSrc(flowTexturePath) : null;
  const constants = layer.materialConstants ?? {};

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !baseSrc || !flowSrc) {
      return;
    }

    const gl = canvas.getContext("webgl", { premultipliedAlpha: true });
    if (!gl) {
      return;
    }
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);

    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertexShader || !fragmentShader) {
      return;
    }

    const vertexSource = `
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}
`;
    const fragmentSource = `
precision mediump float;
uniform sampler2D uBase;
uniform sampler2D uFlow;
uniform float uTime;
uniform float uBrightness;
uniform float uSpeed;
uniform float uAmount;
varying vec2 vTexCoord;
void main() {
  vec3 flowColors = texture2D(uFlow, vTexCoord).rgb;
  vec2 flowMask = (flowColors.rg - vec2(0.5, 0.5)) * 2.0;
  vec2 cycles = vec2(fract(uTime * uSpeed + flowColors.b), fract(uTime * uSpeed + flowColors.b + 0.5));
  float blend = 2.0 * abs(cycles.x - 0.5);
  vec2 offset1 = flowMask * uAmount * 0.1 * cycles.x;
  vec2 offset2 = flowMask * uAmount * 0.1 * cycles.y;
  vec4 color = mix(texture2D(uBase, vTexCoord + offset1), texture2D(uBase, vTexCoord + offset2), blend);
  color.rgb *= uBrightness;
  gl_FragColor = color;
}
`;
    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);
    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS) || !gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      return;
    }

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return;
    }

    const positions = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      1, 0,
    ]);

    const posBuffer = gl.createBuffer();
    const texBuffer = gl.createBuffer();
    if (!posBuffer || !texBuffer) return;

    const loadTexture = (src: string) =>
      new Promise<WebGLTexture | null>((resolve) => {
        const texture = gl.createTexture();
        if (!texture) {
          resolve(null);
          return;
        }

        void fetch(src)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`failed to fetch texture: ${response.status}`);
            }
            return response.blob();
          })
          .then((blob) => createImageBitmap(blob))
          .then((bitmap) => {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
            bitmap.close();
            resolve(texture);
          })
          .catch(() => resolve(null));
      });

    let animationFrame = 0;
    let disposed = false;

    void Promise.all([loadTexture(baseSrc), loadTexture(flowSrc)]).then(([baseTexture, flowTexture]) => {
      if (disposed || !baseTexture || !flowTexture) return;

      const positionLocation = gl.getAttribLocation(program, "aPosition");
      const texCoordLocation = gl.getAttribLocation(program, "aTexCoord");
      const timeLocation = gl.getUniformLocation(program, "uTime");
      const brightnessLocation = gl.getUniformLocation(program, "uBrightness");
      const speedLocation = gl.getUniformLocation(program, "uSpeed");
      const amountLocation = gl.getUniformLocation(program, "uAmount");

      const render = (now: number) => {
        if (disposed) return;
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, baseTexture);
        gl.uniform1i(gl.getUniformLocation(program, "uBase"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, flowTexture);
        gl.uniform1i(gl.getUniformLocation(program, "uFlow"), 1);

        gl.uniform1f(timeLocation, now / 1000);
        gl.uniform1f(brightnessLocation, Number(constants.Bright ?? 1));
        gl.uniform1f(speedLocation, Number(constants.Speed ?? 1));
        gl.uniform1f(amountLocation, Number(constants.Amount ?? 1));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        animationFrame = window.requestAnimationFrame(render);
      };

      animationFrame = window.requestAnimationFrame(render);
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [baseSrc, flowSrc, constants]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__flow-canvas" />;
}

function WallpaperEngineSpectrumEffect({ effect }: { effect: WallpaperEngineSceneEffect }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    const render = (now: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width <= 0 || height <= 0) {
        animationFrame = window.requestAnimationFrame(render);
        return;
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.26;
      const barCount = 64;
      const baseStrength =
        typeof effect.constantShaderValues?.["Sound Strength"] === "number"
          ? effect.constantShaderValues["Sound Strength"]
          : 0.1;
      const ringRadius =
        typeof effect.constantShaderValues?.R === "number"
          ? effect.constantShaderValues.R * Math.min(width, height)
          : radius;
      const color = parseEffectColor(effect.constantShaderValues?.color);

      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.strokeStyle = color;
      context.lineWidth = Math.max(2, width * 0.0045);
      context.globalAlpha = 0.9;

      for (let index = 0; index < barCount; index += 1) {
        const angle = ((Math.PI * 2) / barCount) * index;
        const pulse = 0.55 + (Math.sin((now / 480) + (index * 0.42)) * 0.35) + (Math.cos((now / 760) + (index * 0.27)) * 0.1);
        const barLength = Math.max(3, pulse * baseStrength * Math.min(width, height) * 0.14);
        const startX = cx + Math.sin(angle) * (ringRadius - barLength);
        const startY = cy + Math.cos(angle) * (ringRadius - barLength);
        const endX = cx + Math.sin(angle) * (ringRadius + barLength);
        const endY = cy + Math.cos(angle) * (ringRadius + barLength);
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [effect]);

  return <canvas ref={canvasRef} className="wallpaper-engine-scene__effect-canvas" />;
}

function parseEffectColor(value: unknown) {
  if (typeof value === "string") {
    const [r, g, b] = value.split(/\s+/).map((part) => Number.parseFloat(part));
    return `rgba(${Math.round((r || 0) * 255)}, ${Math.round((g || 0) * 255)}, ${Math.round((b || 0) * 255)}, 0.92)`;
  }
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return parseEffectColor((value as Record<string, unknown>).value);
  }
  return "rgba(255, 255, 255, 0.92)";
}
