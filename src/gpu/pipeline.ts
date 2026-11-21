/**
 * WebGL2 分析管线：亮度纹理 → 单通道特征压缩（MRT 4×RGBA32F，每蛋 16 维）。
 * 数学定义与 CPU 版（src/analysis/features.ts）严格一致。
 * 无 WebGL2 或 EXT_color_buffer_float 时调用方回退 CPU。
 */
import { FEATURE_COUNT, Grid } from '../types';
import { extractFeaturesCpu } from '../analysis/features';

const MAX_GRID = 32;

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FEAT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uLum;
uniform ivec2 uImgSize;
uniform int uCols;
uniform int uRows;
uniform float uCellW;
uniform float uCellH;
uniform float uCx[${MAX_GRID}];
uniform float uCy[${MAX_GRID}];
layout(location=0) out vec4 out0;
layout(location=1) out vec4 out1;
layout(location=2) out vec4 out2;
layout(location=3) out vec4 out3;

float lumAt(int x, int y) {
  return texelFetch(uLum, ivec2(clamp(x, 0, uImgSize.x - 1), clamp(y, 0, uImgSize.y - 1)), 0).r;
}

void main() {
  int col = int(gl_FragCoord.x);
  int row = int(gl_FragCoord.y);
  float cx = uCx[col];
  float cy = uCy[row];
  float rx = uCellW * 0.375;
  float ry = uCellH * 0.44;
  float R = min(rx, ry);
  int x0 = int(floor(cx - rx)), x1 = int(ceil(cx + rx));
  int y0 = int(floor(cy - ry)), y1 = int(ceil(cy + ry));

  // 第一遍：基线 B + 径向剖面 prof[8]
  float baseSum = 0.0, baseCnt = 0.0;
  float profSum[8];
  float profCnt[8];
  for (int b = 0; b < 8; b++) { profSum[b] = 0.0; profCnt[b] = 0.0; }
  for (int y = y0; y <= y1; y++) {
    for (int x = x0; x <= x1; x++) {
      float ex = (float(x) - cx) / rx, ey = (float(y) - cy) / ry;
      float rr = sqrt(ex * ex + ey * ey);
      float c = lumAt(x, y);
      if (rr >= 0.70 && rr <= 0.88) { baseSum += c; baseCnt += 1.0; }
      if (rr < 0.92) {
        int bin = min(7, int(rr / 0.92 * 8.0));
        profSum[bin] += c; profCnt[bin] += 1.0;
      }
    }
  }
  float B = baseCnt > 0.0 ? baseSum / baseCnt : 0.6;
  float prof[8];
  for (int b = 0; b < 8; b++) prof[b] = profCnt[b] > 0.0 ? profSum[b] / profCnt[b] : B;
  float darkTh = B - 0.10;
  float vdarkTh = min(B - 0.20, 0.40);

  // 第二遍：主特征
  float cnt = 0.0, sum = 0.0;
  float dark = 0.0, vdark = 0.0, absDark = 0.0;
  float innerDark = 0.0, innerCnt = 0.0, annDark = 0.0, annCnt = 0.0;
  float vessel = 0.0, vesselCnt = 0.0;
  float darkCx = 0.0, darkCy = 0.0, darkCntW = 0.0;
  float crackMax = 0.0, sideSum = 0.0, sideCnt = 0.0;
  // 裂纹响应直方图（64 桶，0~0.64），用于求 99.5% 分位与超阈占比
  float hist[64];
  for (int b = 0; b < 64; b++) hist[b] = 0.0;
  float crackN = 0.0;

  // 与 CPU 版 Math.round 行为对齐的整数方向/侧向偏移：
  // 轴向：中心±1，侧向±2/±3；对角：中心±1，侧向±1/±2
  ivec2 DIRS[4];
  DIRS[0] = ivec2(1, 0); DIRS[1] = ivec2(0, 1); DIRS[2] = ivec2(1, 1); DIRS[3] = ivec2(1, -1);
  ivec2 PERP[4];
  PERP[0] = ivec2(0, 1); PERP[1] = ivec2(-1, 0); PERP[2] = ivec2(-1, 1); PERP[3] = ivec2(1, 1);
  int SN[4];
  SN[0] = 2; SN[1] = 2; SN[2] = 1; SN[3] = 1;
  int SF[4];
  SF[0] = 3; SF[1] = 3; SF[2] = 2; SF[3] = 2;

  for (int y = y0; y <= y1; y++) {
    for (int x = x0; x <= x1; x++) {
      float ex = (float(x) - cx) / rx, ey = (float(y) - cy) / ry;
      float rr = sqrt(ex * ex + ey * ey);
      if (rr > 0.92) continue;
      float c = lumAt(x, y);
      cnt += 1.0; sum += c;
      bool isDark = c < darkTh;
      if (isDark) { dark += 1.0; darkCx += float(x); darkCy += float(y); darkCntW += 1.0; }
      if (c < vdarkTh) vdark += 1.0;
      if (c < 0.32) absDark += 1.0;
      if (rr < 0.38) { innerCnt += 1.0; if (isDark) innerDark += 1.0; }
      if (rr >= 0.45 && rr <= 0.70) { annCnt += 1.0; if (isDark) annDark += 1.0; }
      if (rr < 0.40) {
        vesselCnt += 1.0;
        float n4 = (lumAt(x - 1, y) + lumAt(x + 1, y) + lumAt(x, y - 1) + lumAt(x, y + 1)) * 0.25;
        if (n4 - c > 0.045 && c < B - 0.03) vessel += 1.0;
      }
      if (rr < 0.80) {
        float profHere = prof[min(7, int(rr / 0.92 * 8.0))];
        float best = 0.0;
        for (int k = 0; k < 4; k++) {
          ivec2 d = DIRS[k];
          ivec2 p = PERP[k];
          float center = (lumAt(x - d.x, y - d.y) + c + lumAt(x + d.x, y + d.y)) / 3.0;
          float sideA = lumAt(x + p.x * SN[k], y + p.y * SN[k]) + lumAt(x + p.x * SF[k], y + p.y * SF[k]);
          float sideB = lumAt(x - p.x * SN[k], y - p.y * SN[k]) + lumAt(x - p.x * SF[k], y - p.y * SF[k]);
          float sideMax = max(sideA, sideB) / 2.0;
          float resp = center - max(sideMax, profHere);
          if (resp > best) best = resp;
          if (resp > 0.05) { sideSum += sideMax; sideCnt += 1.0; }
        }
        int bin = min(63, int(max(best, 0.0) / 0.01));
        hist[bin] += 1.0;
        crackN += 1.0;
        if (best > crackMax) crackMax = best;
      }
    }
  }

  // 第三遍：暗区二阶矩
  float dcx = darkCntW > 0.0 ? darkCx / darkCntW : cx;
  float dcy = darkCntW > 0.0 ? darkCy / darkCntW : cy;
  float spread = 0.0;
  if (darkCntW > 0.0) {
    for (int y = y0; y <= y1; y++) {
      for (int x = x0; x <= x1; x++) {
        float ex = (float(x) - cx) / rx, ey = (float(y) - cy) / ry;
        if (sqrt(ex * ex + ey * ey) > 0.92) continue;
        if (lumAt(x, y) < darkTh) {
          float dx = float(x) - dcx, dy = float(y) - dcy;
          spread += dx * dx + dy * dy;
        }
      }
    }
    spread /= darkCntW;
  }

  // 胚胎点响应：8px 环绕均值 - 3px 中心均值（隔点采样，直接盒求和）
  float dot = 0.0;
  for (int py = int(cy - R * 0.5); py <= int(cy + R * 0.5); py += 2) {
    for (int px = int(cx - R * 0.5); px <= int(cx + R * 0.5); px += 2) {
      float s8 = 0.0, s3 = 0.0;
      for (int dy = -8; dy <= 8; dy++)
        for (int dx = -8; dx <= 8; dx++) s8 += lumAt(px + dx, py + dy);
      for (int dy = -3; dy <= 3; dy++)
        for (int dx = -3; dx <= 3; dx++) s3 += lumAt(px + dx, py + dy);
      float resp = s8 / 289.0 - s3 / 49.0;
      if (resp > dot) dot = resp;
    }
  }

  // 分位与超阈占比
  float p99 = 0.0;
  {
    float need = crackN * 0.005;
    float acc = 0.0;
    for (int b = 63; b >= 0; b--) {
      acc += hist[b];
      if (acc >= need && need > 0.0) { p99 = float(b) * 0.01; break; }
    }
  }
  float lenTh = max(0.04, crackMax * 0.5);
  float crackLen = 0.0;
  {
    float over = 0.0;
    for (int b = 0; b < 64; b++) if (float(b) * 0.01 > lenTh) over += hist[b];
    crackLen = crackN > 0.0 ? over / crackN : 0.0;
  }

  float mean = sum / max(cnt, 1.0);
  float darkFrac = dark / max(cnt, 1.0);
  float annD = annDark / max(annCnt, 1.0);
  float innerD = innerDark / max(innerCnt, 1.0);

  out0 = vec4(mean, B, darkFrac, vdark / max(cnt, 1.0));
  out1 = vec4(innerD, annD, annD - innerD, vessel / max(vesselCnt, 1.0));
  out2 = vec4(dot, crackMax, p99, crackLen);
  out3 = vec4(length(vec2(dcx - cx, dcy - cy)) / R, spread / (R * R),
              sideCnt > 0.0 ? sideSum / sideCnt : 0.0, absDark / max(cnt, 1.0));
}
`;

export interface GpuResult {
  features: Float32Array;
  engine: 'webgl2';
}

export class GpuPipeline {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private fbo: WebGLFramebuffer;
  private textures: WebGLTexture[] = [];
  private lumTex: WebGLTexture;
  private cols = 0;
  private rows = 0;

  private constructor(gl: WebGL2RenderingContext, prog: WebGLProgram) {
    this.gl = gl;
    this.prog = prog;
    this.fbo = gl.createFramebuffer()!;
    this.lumTex = gl.createTexture()!;
  }

  /** 创建管线；环境不支持时返回 null（调用方回退 CPU） */
  static create(): GpuPipeline | null {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { willReadFrequently: false }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    if (!gl.getExtension('EXT_color_buffer_float')) return null;
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FEAT_FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    // 全屏三角形
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    return new GpuPipeline(gl, prog);
  }

  /** 上传亮度图（R32F） */
  private uploadLum(lum: Float32Array, w: number, h: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lumTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, lum);
  }

  /** 重建特征输出 FBO（cols×rows，4×RGBA32F） */
  private setupTargets(cols: number, rows: number) {
    const gl = this.gl;
    if (cols === this.cols && rows === this.rows) return;
    for (const t of this.textures) gl.deleteTexture(t);
    this.textures = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    for (let i = 0; i < 4; i++) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cols, rows, 0, gl.RGBA, gl.FLOAT, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      this.textures.push(tex);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('FBO incomplete');
    }
    this.cols = cols;
    this.rows = rows;
  }

  /** 运行特征提取，返回 rows*cols*16 */
  extract(lum: Float32Array, w: number, h: number, grid: Grid): Float32Array {
    const gl = this.gl;
    if (grid.cols > MAX_GRID || grid.rows > MAX_GRID) throw new Error(`蛋盘超过 ${MAX_GRID}×${MAX_GRID}`);
    this.uploadLum(lum, w, h);
    this.setupTargets(grid.cols, grid.rows);
    gl.useProgram(this.prog);
    const u = (name: string) => gl.getUniformLocation(this.prog, name);
    gl.uniform1i(u('uLum'), 0);
    gl.uniform2i(u('uImgSize'), w, h);
    gl.uniform1i(u('uCols'), grid.cols);
    gl.uniform1i(u('uRows'), grid.rows);
    gl.uniform1f(u('uCellW'), grid.cellW);
    gl.uniform1f(u('uCellH'), grid.cellH);
    gl.uniform1fv(u('uCx[0]'), grid.cx);
    gl.uniform1fv(u('uCy[0]'), grid.cy);
    // setupTargets 会把输出纹理绑到 TEXTURE0，绘制前必须重新绑定亮度纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lumTex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, grid.cols, grid.rows);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const n = grid.cols * grid.rows;
    const out = new Float32Array(n * FEATURE_COUNT);
    const buf = new Float32Array(n * 4);
    for (let i = 0; i < 4; i++) {
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + i);
      gl.readPixels(0, 0, grid.cols, grid.rows, gl.RGBA, gl.FLOAT, buf);
      for (let e = 0; e < n; e++) {
        for (let k = 0; k < 4; k++) out[e * FEATURE_COUNT + i * 4 + k] = buf[e * 4 + k];
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
}

let gpuInstance: GpuPipeline | null | undefined;

/** 提取特征：优先 WebGL2，失败回退 CPU。返回特征与所用引擎。 */
export function extractFeatures(
  lum: Float32Array,
  w: number,
  h: number,
  grid: Grid,
): { features: Float32Array; engine: 'webgl2' | 'cpu' } {
  if (gpuInstance === undefined) gpuInstance = GpuPipeline.create();
  if (gpuInstance) {
    try {
      return { features: gpuInstance.extract(lum, w, h, grid), engine: 'webgl2' };
    } catch (e) {
      console.warn('WebGL2 管线失败，回退 CPU', e);
      gpuInstance = null;
    }
  }
  return { features: extractFeaturesCpu(lum, w, h, grid), engine: 'cpu' };
}
