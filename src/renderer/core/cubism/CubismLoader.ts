import { CubismFramework, LogLevel, Option } from '@framework/live2dcubismframework';
import { CubismMoc } from '@framework/model/cubismmoc';
import type { CubismModel } from '@framework/model/cubismmodel';
import { CubismRenderer_WebGL } from '@framework/rendering/cubismrenderer_webgl';
import type { Cdi3Json, Model3Json } from '@shared/types/live2d-files';
import { buildModelInfo, type ModelInfo } from './ModelInfo';

let frameworkStarted = false;

/**
 * Boots the Cubism framework exactly once per renderer process.
 *
 * `startUp` must precede `initialize`, and the Core global must already exist —
 * it is imported for side effects in the renderer entry point, before any
 * framework module is evaluated, because some framework enums read Core
 * constants at module scope.
 */
export function ensureFrameworkStarted(): void {
  if (frameworkStarted) return;

  const option = new Option();
  option.logFunction = (message: string) => console.info('[cubism]', message);
  option.loggingLevel = import.meta.env.DEV ? LogLevel.LogLevel_Warning : LogLevel.LogLevel_Error;

  CubismFramework.startUp(option);
  CubismFramework.initialize();
  frameworkStarted = true;
}

export interface LoadedTexture {
  index: number;
  glTexture: WebGLTexture;
  width: number;
  height: number;
}

export interface LoadedModel {
  moc: CubismMoc;
  model: CubismModel;
  renderer: CubismRenderer_WebGL;
  info: ModelInfo;
  textures: LoadedTexture[];
}

export interface LoadModelRequest {
  gl: WebGL2RenderingContext;
  mocBuffer: ArrayBuffer;
  modelSetting: Model3Json;
  displayInfo: Cdi3Json | null;
  /** Decoded texture images in the order `FileReferences.Textures` lists them. */
  textureImages: ImageBitmap[];
}

export class ModelLoadError extends Error {}

/**
 * Creates the model, its renderer and its GL textures.
 *
 * Consistency checking is on: a corrupted or truncated moc3 fails here with a
 * clear message instead of crashing inside the Core later.
 */
export function loadModel(request: LoadModelRequest): LoadedModel {
  ensureFrameworkStarted();

  const { gl, mocBuffer, modelSetting, displayInfo, textureImages } = request;

  const mocVersion = Live2DCubismCore.Version.csmGetMocVersion(mocBuffer);
  if (mocVersion === Live2DCubismCore.MocVersion_Unknown) {
    throw new ModelLoadError('Không đọc được phiên bản .moc3 (file có thể bị hỏng).');
  }
  if (mocVersion > Live2DCubismCore.Version.csmGetLatestMocVersion()) {
    throw new ModelLoadError(
      'Model được tạo bằng Cubism mới hơn Core đang dùng. Hãy cập nhật app.'
    );
  }

  const moc = CubismMoc.create(mocBuffer, true);
  if (!moc) {
    throw new ModelLoadError('File .moc3 không vượt qua kiểm tra tính nhất quán.');
  }

  const model = moc.createModel();
  if (!model) {
    CubismMoc.delete(moc);
    throw new ModelLoadError('Không tạo được model từ .moc3.');
  }

  // Honour the repeat flags the model author baked in, instead of the
  // framework's default of clamping every parameter.
  model.setOverrideFlagForModelParameterRepeat(false);

  const info = buildModelInfo(model, mocVersion, displayInfo);

  const renderer = new CubismRenderer_WebGL(
    info.canvas.widthPixel,
    info.canvas.heightPixel
  );
  renderer.initialize(model, 1);
  renderer.startUp(gl);
  renderer.setIsPremultipliedAlpha(true);

  const textures: LoadedTexture[] = [];
  const expected = modelSetting.FileReferences.Textures.length;
  for (let index = 0; index < Math.min(expected, textureImages.length); index += 1) {
    const image = textureImages[index];
    const glTexture = createGlTexture(gl, image);
    renderer.bindTexture(index, glTexture);
    textures.push({ index, glTexture, width: image.width, height: image.height });
  }

  return { moc, model, renderer, info, textures };
}

function createGlTexture(gl: WebGL2RenderingContext, image: ImageBitmap): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // The renderer is configured for premultiplied alpha, so the upload must match.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return texture;
}

export function releaseModel(gl: WebGL2RenderingContext, loaded: LoadedModel): void {
  for (const texture of loaded.textures) gl.deleteTexture(texture.glTexture);
  loaded.renderer.release();
  loaded.moc.deleteModel(loaded.model);
  CubismMoc.delete(loaded.moc);
}
