import type { RegionMask } from './RegionMasker';

/**
 * A non-destructive adjustment applied inside a mask.
 *
 * Stored as parameters rather than baked pixels so it stays editable: the user
 * can come back and change the hue of the jacket they recoloured last week, and
 * undo is a plain JSON change rather than a bitmap snapshot.
 */
export interface RecolorLayer {
  id: string;
  kind: 'recolor';
  name: string;
  visible: boolean;
  textureIndex: number;
  /** Degrees, -180..180. */
  hue: number;
  /** -1..1, where 0 leaves saturation alone. */
  saturation: number;
  /** -1..1, where 0 leaves lightness alone. */
  lightness: number;
  /** Blends the region towards a flat colour; 0 disables it. */
  colorize: { enabled: boolean; color: string; strength: number };
  /** Serialised mask bounds and pixels, so a layer survives a reload. */
  mask: SerializedMask;
}

/** Freehand strokes, kept as pixels because that is what they are. */
export interface PaintLayer {
  id: string;
  kind: 'paint';
  name: string;
  visible: boolean;
  textureIndex: number;
  opacity: number;
  /** PNG data URL of the stroke layer at texture resolution. */
  pixels: string;
}

export type TextureLayer = RecolorLayer | PaintLayer;

export interface SerializedMask {
  width: number;
  height: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  /** Run-length encoded mask: alternating run lengths, starting with "off". */
  runs: number[];
}

/** Packs a mask small enough to store in the project file. */
export function serializeMask(mask: RegionMask): SerializedMask {
  const runs: number[] = [];
  let current = 0;
  let length = 0;

  for (let index = 0; index < mask.data.length; index += 1) {
    const value = mask.data[index] > 0 ? 1 : 0;
    if (value === current) {
      length += 1;
    } else {
      runs.push(length);
      current = value;
      length = 1;
    }
  }
  runs.push(length);

  return { width: mask.width, height: mask.height, bounds: mask.bounds, runs };
}

export function deserializeMask(serialized: SerializedMask): RegionMask {
  const data = new Uint8Array(serialized.width * serialized.height);
  let index = 0;
  let value = 0;

  for (const run of serialized.runs) {
    if (value === 1) data.fill(255, index, index + run);
    index += run;
    value = value === 1 ? 0 : 1;
  }

  return {
    textureIndex: 0,
    width: serialized.width,
    height: serialized.height,
    data,
    bounds: serialized.bounds
  };
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Applies hue/saturation/lightness inside a mask.
 *
 * Runs on the GPU because a 4096² texture is 16 million pixels and doing this in
 * JavaScript on every slider move would take seconds per frame. The HSL
 * conversion is the standard one; what matters here is that every change is
 * weighted by the mask so nothing outside the selected artwork moves.
 */
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform sampler2D u_mask;
uniform float u_hue;
uniform float u_saturation;
uniform float u_lightness;
uniform float u_colorizeStrength;
uniform vec3 u_colorizeColor;

vec3 rgbToHsl(vec3 color) {
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float lightness = (maxC + minC) * 0.5;
  float hue = 0.0;
  float saturation = 0.0;

  if (maxC > minC) {
    float delta = maxC - minC;
    saturation = lightness > 0.5
      ? delta / (2.0 - maxC - minC)
      : delta / (maxC + minC);

    if (maxC == color.r) {
      hue = (color.g - color.b) / delta + (color.g < color.b ? 6.0 : 0.0);
    } else if (maxC == color.g) {
      hue = (color.b - color.r) / delta + 2.0;
    } else {
      hue = (color.r - color.g) / delta + 4.0;
    }
    hue /= 6.0;
  }
  return vec3(hue, saturation, lightness);
}

float hueToRgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  if (hsl.y <= 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hueToRgb(p, q, hsl.x + 1.0 / 3.0),
    hueToRgb(p, q, hsl.x),
    hueToRgb(p, q, hsl.x - 1.0 / 3.0)
  );
}

void main() {
  vec4 source = texture(u_source, v_uv);
  float maskValue = texture(u_mask, v_uv).r;

  if (maskValue <= 0.0 || source.a <= 0.0) {
    outColor = source;
    return;
  }

  // The source arrives as straight alpha, because the decoded PNG is uploaded
  // without UNPACK_PREMULTIPLY_ALPHA. Premultiplying happens later, when the
  // result is handed to the model renderer.
  vec3 straight = source.rgb;

  vec3 hsl = rgbToHsl(clamp(straight, 0.0, 1.0));
  hsl.x = fract(hsl.x + u_hue);
  hsl.y = clamp(hsl.y * (1.0 + u_saturation), 0.0, 1.0);
  // Lightness moves toward white or black by the slider amount, scaled by the
  // headroom left in that direction. Applying the slider a second time flat, as
  // an earlier version did, drove every adjusted pixel to an extreme.
  hsl.z = clamp(
    u_lightness >= 0.0
      ? hsl.z + (1.0 - hsl.z) * u_lightness
      : hsl.z + hsl.z * u_lightness,
    0.0,
    1.0
  );

  vec3 adjusted = hslToRgb(hsl);

  if (u_colorizeStrength > 0.0) {
    // Keep the artwork's own shading by carrying its luminance into the target
    // colour, rather than flooding the region flat.
    vec3 target = rgbToHsl(u_colorizeColor);
    vec3 tinted = hslToRgb(vec3(target.x, target.y, rgbToHsl(adjusted).z));
    adjusted = mix(adjusted, tinted, u_colorizeStrength);
  }

  vec3 result = mix(straight, adjusted, maskValue);
  outColor = vec4(result, source.a);
}`;

/**
 * Composites a texture's layer stack on the GPU.
 *
 * One instance per editing session; it owns its own offscreen GL context so the
 * preview's context is never disturbed.
 */
export class TextureCompositor {
  private readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly quad: WebGLBuffer;
  private readonly maskTexture: WebGLTexture;
  private readonly sourceTexture: WebGLTexture;
  private readonly targetTexture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private targetWidth = 0;
  private targetHeight = 0;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    // preserveDrawingBuffer, because the result is read back with drawImage
    // after the draw call returns. Without it the browser is free to clear the
    // buffer first, and the copy comes out empty.
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error('Không tạo được WebGL2 để xử lý texture.');
    this.gl = gl;

    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.quad = createQuad(gl);
    // The mask is a stencil, not an image: linear filtering would blur its edge
    // into fractional coverage and leave a halo of half-recoloured pixels.
    this.maskTexture = createEmptyTexture(gl, gl.NEAREST);
    this.sourceTexture = createEmptyTexture(gl);
    this.targetTexture = createEmptyTexture(gl, gl.NEAREST);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Không tạo được framebuffer.');
    this.framebuffer = framebuffer;
  }

  /** Points rendering at an owned framebuffer of the requested size. */
  private bindTarget(width: number, height: number): void {
    const { gl } = this;

    if (this.targetWidth !== width || this.targetHeight !== height) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.targetWidth = width;
      this.targetHeight = height;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.targetTexture,
      0
    );

    // An incomplete framebuffer discards every draw silently, which is
    // indistinguishable from a shader that writes nothing — so check once here
    // rather than debugging the shader later.
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer không hợp lệ (0x${status.toString(16)}).`);
    }
  }

  /**
   * Runs one recolour layer over a source image and returns the result.
   *
   * Layers are applied one at a time, each reading the previous result, so a
   * stack of adjustments composes the way the user expects.
   */
  applyRecolor(
    source: ImageBitmap | OffscreenCanvas,
    layer: RecolorLayer,
    mask: RegionMask
  ): OffscreenCanvas {
    const { gl } = this;

    this.bindTarget(mask.width, mask.height);
    gl.viewport(0, 0, mask.width, mask.height);

    // Each upload has to select its own texture unit first. Binding both to the
    // default unit — as an earlier version did — meant the mask overwrote the
    // source binding, and the shader sampled the mask as if it were the artwork,
    // turning every adjusted pixel black.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // The mask is one byte per pixel, so it uploads as a single-channel texture
    // and is read from .r in the shader.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      mask.width,
      mask.height,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      mask.data
    );

    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_source'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTexture);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_mask'), 1);

    gl.uniform1f(gl.getUniformLocation(this.program, 'u_hue'), layer.hue / 360);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_saturation'), layer.saturation);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_lightness'), layer.lightness);
    gl.uniform1f(
      gl.getUniformLocation(this.program, 'u_colorizeStrength'),
      layer.colorize.enabled ? layer.colorize.strength : 0
    );
    const rgb = hexToRgb(layer.colorize.color);
    gl.uniform3f(
      gl.getUniformLocation(this.program, 'u_colorizeColor'),
      rgb.r,
      rgb.g,
      rgb.b
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const position = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Read the framebuffer we just drew into. Reading here, while it is still
    // bound, is what makes the result independent of anything the browser does
    // to the canvas afterwards.
    const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
    gl.readPixels(0, 0, mask.width, mask.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const output = new OffscreenCanvas(mask.width, mask.height);
    const context = output.getContext('2d');
    if (!context) throw new Error('Không tạo được canvas 2D để ghép layer.');
    // No row reversal here. The source is uploaded without UNPACK_FLIP_Y, so
    // texel row 0 is the canvas's top row, and the shader's v_uv.y=0 is the
    // framebuffer's bottom row — the render is already stored upside down.
    // readPixels then returns rows bottom-up, which undoes exactly that. The
    // buffer is already top-down; reversing again mirrored the result.
    context.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
    return output;
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quad);
    gl.deleteTexture(this.maskTexture);
    gl.deleteTexture(this.sourceTexture);
    gl.deleteTexture(this.targetTexture);
    gl.deleteFramebuffer(this.framebuffer);
  }
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram {
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Không tạo được shader.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Lỗi biên dịch shader: ${log}`);
    }
    return shader;
  };

  const program = gl.createProgram();
  if (!program) throw new Error('Không tạo được chương trình shader.');
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Lỗi liên kết shader: ${log}`);
  }
  return program;
}

function createQuad(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Không tạo được buffer.');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  return buffer;
}

function createEmptyTexture(
  gl: WebGL2RenderingContext,
  filter: number = gl.LINEAR
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Không tạo được texture.');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(
    clean.length === 3
      ? clean
          .split('')
          .map((character) => character + character)
          .join('')
      : clean,
    16
  );
  if (Number.isNaN(value)) return { r: 1, g: 1, b: 1 };
  return {
    r: ((value >> 16) & 255) / 255,
    g: ((value >> 8) & 255) / 255,
    b: (value & 255) / 255
  };
}
