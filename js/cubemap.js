/*!
 * Mineraft_MenuPic_Generator — 核心立方体贴图数学（无依赖，浏览器 / Node 通用）
 *
 * 世界坐标（右手系，与 Minecraft 一致）：
 *   +X = 东(east)   +Y = 上(up)   +Z = 南(south)
 *
 * panorama_N 的面朝向与图内方向（推导与实测见 docs/panorama-format.md）：
 *   面内像素 (u,v)，u: 0→1 左到右，v: 0→1 上到下，对应的三维方向
 *     dir(u,v) ∝ F + R·(2u-1) + U·(1-2v)
 *   立方体半棱长为 1 时上式无需再缩放，且 |dir| 的最大分量恒为 1。
 *
 * 全景图（等距柱状 / equirectangular）坐标：
 *   u = 0.5 + λ/360°，λ 为罗盘方位角（0° = 北，+90° = 东）
 *   v = 0.5 - φ/180°，φ 为纬度（+90° = 天顶）
 *   即图片水平中心 = 正北。
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  /* ------------------------------------------------------------------ *
   * 六个面
   * ------------------------------------------------------------------ */
  var FACES = [
    { n: 0, key: 'north', zh: '北', tag: '前', F: [0, 0, -1], R: [1, 0, 0], U: [0, 1, 0] },
    { n: 1, key: 'east', zh: '东', tag: '右', F: [1, 0, 0], R: [0, 0, 1], U: [0, 1, 0] },
    { n: 2, key: 'south', zh: '南', tag: '后', F: [0, 0, 1], R: [-1, 0, 0], U: [0, 1, 0] },
    { n: 3, key: 'west', zh: '西', tag: '左', F: [-1, 0, 0], R: [0, 0, -1], U: [0, 1, 0] },
    { n: 4, key: 'up', zh: '上', tag: '顶', F: [0, 1, 0], R: [1, 0, 0], U: [0, 0, 1] },
    { n: 5, key: 'down', zh: '下', tag: '底', F: [0, -1, 0], R: [1, 0, 0], U: [0, 0, -1] }
  ];

  /** 面内 (u,v) -> 单位方向向量，返回 [x,y,z] */
  function dirFromFace(f, u, v) {
    var fa = FACES[f];
    var s = 2 * u - 1;
    var t = 1 - 2 * v;
    var x = fa.F[0] + fa.R[0] * s + fa.U[0] * t;
    var y = fa.F[1] + fa.R[1] * s + fa.U[1] * t;
    var z = fa.F[2] + fa.R[2] * s + fa.U[2] * t;
    var inv = 1 / Math.sqrt(x * x + y * y + z * z);
    return [x * inv, y * inv, z * inv];
  }

  /** 单位方向 -> {face, u, v}（立方体投影的逆运算） */
  function faceUVFromDir(x, y, z) {
    var ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    var f;
    if (ax >= ay && ax >= az) f = x > 0 ? 1 : 3;
    else if (ay >= az) f = y > 0 ? 4 : 5;
    else f = z > 0 ? 2 : 0;
    var inv = 1 / Math.max(ax, ay, az);
    x *= inv; y *= inv; z *= inv;
    var fa = FACES[f];
    var u = 0.5 + 0.5 * (x * fa.R[0] + y * fa.R[1] + z * fa.R[2]);
    var v = 0.5 - 0.5 * (x * fa.U[0] + y * fa.U[1] + z * fa.U[2]);
    return { face: f, u: u, v: v };
  }

  /** 球面旋转：先绕 +X(东) 俯仰，再绕 +Y 偏航。yaw/pitch 单位为弧度。 */
  function rotateDir(x, y, z, yaw, pitch) {
    if (pitch) {
      var cp = Math.cos(pitch), sp = Math.sin(pitch);
      var y1 = y * cp - z * sp;
      var z1 = y * sp + z * cp;
      y = y1; z = z1;
    }
    if (yaw) {
      var cy = Math.cos(yaw), sy = Math.sin(yaw);
      var x1 = x * cy + z * sy;
      var z2 = -x * sy + z * cy;
      x = x1; z = z2;
    }
    return [x, y, z];
  }

  /** 方向 -> 等距柱状图 uv（u 环绕，v 夹取） */
  function dirToEquirectUV(x, y, z) {
    var lon = Math.atan2(x, -z);          // 0 = 北, +90° = 东
    var lat = Math.asin(Math.max(-1, Math.min(1, y)));
    var u = 0.5 + lon / TAU;
    u -= Math.floor(u);
    var v = 0.5 - lat / Math.PI;
    return [u, v];
  }

  /* ------------------------------------------------------------------ *
   * 图像工具：图像一律表示为 {width, height, data:Uint8ClampedArray}
   * ------------------------------------------------------------------ */
  function makeImage(w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  function wrap(v, n) { v %= n; return v < 0 ? v + n : v; }
  function clamp(v, n) { return v < 0 ? 0 : (v > n - 1 ? n - 1 : v); }

  /**
   * 采样。fx/fy 为浮点像素坐标（整数 = 像素中心）。
   * opts.wrapX 水平环绕；opts.nearest 最近邻。
   * 返回 [r,g,b,a] 写入 out 数组。
   */
  function sampleImage(img, fx, fy, opts, out) {
    var W = img.width, H = img.height, d = img.data;
    var wrapX = !opts || opts.wrapX !== false;
    var nearest = !!(opts && opts.nearest);
    var x0 = Math.floor(fx), y0 = Math.floor(fy);
    var tx = fx - x0, ty = fy - y0;
    if (nearest) { tx = tx < 0.5 ? 0 : 1; ty = ty < 0.5 ? 0 : 1; }
    var x1 = x0 + 1, y1 = y0 + 1;
    if (wrapX) {
      x0 = ((x0 % W) + W) % W; x1 = ((x1 % W) + W) % W;
    } else {
      x0 = x0 < 0 ? 0 : (x0 > W - 1 ? W - 1 : x0);
      x1 = x1 < 0 ? 0 : (x1 > W - 1 ? W - 1 : x1);
    }
    y0 = y0 < 0 ? 0 : (y0 > H - 1 ? H - 1 : y0);
    y1 = y1 < 0 ? 0 : (y1 > H - 1 ? H - 1 : y1);
    var w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    var i00 = (y0 * W + x0) << 2, i10 = (y0 * W + x1) << 2;
    var i01 = (y1 * W + x0) << 2, i11 = (y1 * W + x1) << 2;
    for (var c = 0; c < 4; c++) {
      out[c] = d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11;
    }
    return out;
  }

  function drawToCanvas(img) {
    var cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    var cx = cv.getContext('2d');
    var id = cx.createImageData(img.width, img.height);
    id.data.set(img.data);
    cx.putImageData(id, 0, 0);
    return cv;
  }

  function canvasToImage(cv) {
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var id = cx.getImageData(0, 0, cv.width, cv.height);
    return { width: cv.width, height: cv.height, data: id.data };
  }

  /* ------------------------------------------------------------------ *
   * 模式 1：等距柱状全景 -> 立方体（核心模式）
   * opts: { yaw, pitch, flipV, flipH, nearest, S }
   * ------------------------------------------------------------------ */
  function equirectToCube(src, S, opts) {
    opts = opts || {};
    var yaw = (opts.yaw || 0) * D2R;
    var pitch = (opts.pitch || 0) * D2R;
    var flipV = !!opts.flipV, flipH = !!opts.flipH;
    var out = [];
    var tmp = [0, 0, 0, 0];
    for (var f = 0; f < 6; f++) {
      var fa = FACES[f];
      var dst = makeImage(S, S);
      var d = dst.data;
      for (var j = 0; j < S; j++) {
        var t = 1 - 2 * ((j + 0.5) / S);
        for (var i = 0; i < S; i++) {
          var s = 2 * ((i + 0.5) / S) - 1;
          var x = fa.F[0] + fa.R[0] * s + fa.U[0] * t;
          var y = fa.F[1] + fa.R[1] * s + fa.U[1] * t;
          var z = fa.F[2] + fa.R[2] * s + fa.U[2] * t;
          var inv = 1 / Math.sqrt(x * x + y * y + z * z);
          var r = rotateDir(x * inv, y * inv, z * inv, yaw, pitch);
          var uv = dirToEquirectUV(r[0], r[1], r[2]);
          var u = uv[0], v = uv[1];
          if (flipH) u = 1 - u;
          if (flipV) v = 1 - v;
          sampleImage(src, u * src.width - 0.5, v * src.height - 0.5, opts, tmp);
          var o = (j * S + i) << 2;
          d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
        }
      }
      out.push(dst);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 模式 2：网格/十字拼合图 -> 六个面
   * opts.layout = [{face, col, row}, ...] 或
   *        {cols, rows, cells:[[cellIndex per face]]}
   * 采用 LAYOUTS 里的预设。
   * ------------------------------------------------------------------ */
  var LAYOUTS = {
    'mc-3x2': {
      zh: '3×2 顺序（MC 顺序 012 / 345）',
      cols: 3, rows: 2,
      map: { 0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [0, 1], 4: [1, 1], 5: [2, 1] }
    },
    'mc-2x3': {
      zh: '2×3 顺序（竖排两列）',
      cols: 2, rows: 3,
      map: { 0: [0, 0], 1: [1, 0], 2: [0, 1], 3: [1, 1], 4: [0, 2], 5: [1, 2] }
    },
    'strip-6x1': {
      zh: '6×1 横排（012345）',
      cols: 6, rows: 1,
      map: { 0: [0, 0], 1: [1, 0], 2: [2, 0], 3: [3, 0], 4: [4, 0], 5: [5, 0] }
    },
    'strip-1x6': {
      zh: '1×6 竖排（012345）',
      cols: 1, rows: 6,
      map: { 0: [0, 0], 1: [0, 1], 2: [0, 2], 3: [0, 3], 4: [0, 4], 5: [0, 5] }
    },
    'cross-h': {
      zh: '4×3 横十字（西 北 东 南 一圈，顶/底居中）',
      cols: 4, rows: 3,
      map: { 4: [1, 0], 3: [0, 1], 0: [1, 1], 1: [2, 1], 2: [3, 1], 5: [1, 2] }
    },
    'cross-v': {
      zh: '3×4 竖十字',
      cols: 3, rows: 4,
      map: { 4: [1, 0], 3: [0, 1], 0: [1, 1], 1: [2, 1], 5: [1, 2], 2: [1, 3] }
    },
    'skybox-3x2': {
      zh: '3×2 常见 skybox 布局（上/前/下 在上排）',
      cols: 3, rows: 2,
      map: { 4: [0, 0], 0: [1, 0], 5: [2, 0], 3: [0, 1], 2: [1, 1], 1: [2, 1] }
    }
  };

  function gridToCube(src, S, opts) {
    opts = opts || {};
    var lay = LAYOUTS[opts.layout] || LAYOUTS['mc-3x2'];
    var cw = src.width / lay.cols, ch = src.height / lay.rows;
    var rot = (((opts.rotate || 0) % 4) + 4) % 4;
    var out = [];
    for (var f = 0; f < 6; f++) {
      var dst = makeImage(S, S);
      var cell = lay.map[f];
      if (!cell) { out.push(dst); continue; }   // 布局里没占位的面留空（透明）
      var sx = cell[0] * cw, sy = cell[1] * ch;
      var tile = cropTile(src, sx, sy, cw, ch, S, opts.fit);
      out.push(rotateQuadrant(tile, rot));
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 模式 3：单图直接覆盖（整图铺到每一面）
   * opts: { fit:'stretch'|'cover'|'contain', rotateStep:0|1 }
   * ------------------------------------------------------------------ */
  function stretchToCube(src, S, opts) {
    opts = opts || {};
    var step = opts.rotateStep || 0;
    var out = [];
    for (var f = 0; f < 6; f++) {
      var base = fitTile(src, S, opts.fit);
      out.push(rotateQuadrant(base, (f * step) % 4));
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 模式 4：单图复制平铺（可选镜像，得到无缝墙纸效果）
   * opts: { tiles, mirror, fit, rotateStep }
   * ------------------------------------------------------------------ */
  function tileToCube(src, S, opts) {
    opts = opts || {};
    var n = Math.max(1, Math.min(16, opts.tiles || 2));
    var t = S / n;
    var out = [];
    for (var f = 0; f < 6; f++) {
      var dst = makeImage(S, S);
      var d = dst.data;
      var tmp = [0, 0, 0, 0];
      var rot = ((f * (opts.rotateStep || 0)) % 4 + 4) % 4;
      for (var j = 0; j < S; j++) {
        for (var i = 0; i < S; i++) {
          // 先把目标像素旋转回“未旋转”的平铺坐标系
          var x = i + 0.5, y = j + 0.5;
          var rr = rotQuadPoint(x, y, S, 4 - rot);
          var cx = Math.floor((rr[0] - 1e-9) / t), cy = Math.floor((rr[1] - 1e-9) / t);
          var lu = (rr[0] - cx * t) / t, lv = (rr[1] - cy * t) / t;
          if (opts.mirror) {
            if (cx & 1) lu = 1 - lu;
            if (cy & 1) lv = 1 - lv;
          }
          sampleImage(src, lu * src.width - 0.5, lv * src.height - 0.5,
            { wrapX: false, nearest: opts.nearest }, tmp);
          var o = (j * S + i) << 2;
          d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
        }
      }
      out.push(dst);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 模式 5（实验）：圆形鱼眼（天顶视角）-> 立方体
   * opts: { fov: 鱼眼覆盖的角度(默认180), rot: 图片内旋转, nearest }
   * ------------------------------------------------------------------ */
  function fisheyeToCube(src, S, opts) {
    opts = opts || {};
    var fov = (opts.fov || 180) * D2R;
    var rot = (opts.rot || 0) * D2R;
    var W = src.width, H = src.height;
    var cx = W / 2 - 0.5, cy = H / 2 - 0.5;
    var R = Math.min(W, H) / 2;
    var out = [];
    var tmp = [0, 0, 0, 0];
    for (var f = 0; f < 6; f++) {
      var fa = FACES[f];
      var dst = makeImage(S, S);
      var d = dst.data;
      for (var j = 0; j < S; j++) {
        var t = 1 - 2 * ((j + 0.5) / S);
        for (var i = 0; i < S; i++) {
          var s = 2 * ((i + 0.5) / S) - 1;
          var x = fa.F[0] + fa.R[0] * s + fa.U[0] * t;
          var y = fa.F[1] + fa.R[1] * s + fa.U[1] * t;
          var z = fa.F[2] + fa.R[2] * s + fa.U[2] * t;
          var inv = 1 / Math.sqrt(x * x + y * y + z * z);
          x *= inv; y *= inv; z *= inv;
          // 光轴 = +Y(天顶)
          var theta = Math.acos(Math.max(-1, Math.min(1, y)));
          var rr = R * theta / fov * 2;   // fov 对应 2R
          var phi = Math.atan2(x, z) + rot;
          var fx = cx + rr * Math.sin(phi);
          var fy = cy - rr * Math.cos(phi);
          sampleImage(src, fx, fy, { wrapX: false, nearest: opts.nearest }, tmp);
          var o = (j * S + i) << 2;
          d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
        }
      }
      out.push(dst);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 图像拼装小工具
   * ------------------------------------------------------------------ */
  /** 从 src 裁出 (sx,sy,cw,ch) 并缩放到 size×size */
  function cropTile(src, sx, sy, cw, ch, size, fit) {
    var dst = makeImage(size, size);
    var d = dst.data;
    var tmp = [0, 0, 0, 0];
    for (var j = 0; j < size; j++) {
      for (var i = 0; i < size; i++) {
        var u = (i + 0.5) / size, v = (j + 0.5) / size;
        sampleImage(src, sx + u * cw - 0.5, sy + v * ch - 0.5, { wrapX: false }, tmp);
        var o = (j * size + i) << 2;
        d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
      }
    }
    return dst;
  }

  function fitTile(src, size, mode) {
    mode = mode || 'cover';
    if (mode === 'stretch') return cropTile(src, 0, 0, src.width, src.height, size);
    var ar = src.width / src.height;
    var cw = src.width, ch = src.height, sx = 0, sy = 0;
    if (mode === 'cover') {
      if (ar > 1) { cw = src.height; sx = (src.width - cw) / 2; }
      else { ch = src.width; sy = (src.height - ch) / 2; }
    } else { // contain：留边（黑边）
      var dst = makeImage(size, size);
      var inner;
      if (ar > 1) inner = [0, Math.round((size - size / ar) / 2), size, Math.round(size / ar)];
      else inner = [Math.round((size - size * ar) / 2), 0, Math.round(size * ar), size];
      var scaled = cropTile(src, 0, 0, src.width, src.height, Math.max(1, inner[2]), Math.max(1, inner[3]));
      // 直接贴回
      for (var j = 0; j < inner[3]; j++) {
        for (var i = 0; i < inner[2]; i++) {
          var so = (j * inner[2] + i) << 2;
          var to = ((j + inner[1]) * size + (i + inner[0])) << 2;
          if (to < dst.data.length) {
            dst.data[to] = scaled.data[so];
            dst.data[to + 1] = scaled.data[so + 1];
            dst.data[to + 2] = scaled.data[so + 2];
            dst.data[to + 3] = 255;
          }
        }
      }
      return dst;
    }
    return cropTile(src, sx, sy, cw, ch, size);
  }

  function rotQuadPoint(x, y, size, quarter) {
    // 以面中心为原点顺时针旋转 quarter×90°
    for (var k = 0; k < quarter; k++) {
      var nx = size - y, ny = x;
      x = nx; y = ny;
    }
    return [x, y];
  }

  /** 把 size×size 图像顺时针旋转 quarter×90° */
  function rotateQuadrant(img, quarter) {
    quarter = (((quarter % 4) + 4) % 4);
    if (!quarter) return img;
    var size = img.width, s = img.height;
    var dst = makeImage(size, s);
    for (var j = 0; j < s; j++) {
      for (var i = 0; i < size; i++) {
        var p = rotQuadPoint(i + 0.5, j + 0.5, size, 4 - quarter);
        var si = Math.min(size - 1, Math.max(0, Math.round(p[0] - 0.5)));
        var sj = Math.min(s - 1, Math.max(0, Math.round(p[1] - 0.5)));
        var so = (sj * size + si) << 2, to = (j * size + i) << 2;
        dst.data[to] = img.data[so];
        dst.data[to + 1] = img.data[so + 1];
        dst.data[to + 2] = img.data[so + 2];
        dst.data[to + 3] = img.data[so + 3];
      }
    }
    return dst;
  }

  /* ------------------------------------------------------------------ *
   * 整体水平旋转 k×90°（真正的三维旋转：绕 +Y 轴转内容，仍然无缝）
   * ------------------------------------------------------------------ */
  function rotateCubeY(imgs, k) {
    k = (((k | 0) % 4) + 4) % 4;
    if (!k) return imgs;
    var S = imgs[0].width;
    var a = -k * Math.PI / 2;
    var out = [];
    var tmp = [0, 0, 0, 0];
    for (var f = 0; f < 6; f++) {
      var dst = makeImage(S, S);
      var d = dst.data;
      for (var j = 0; j < S; j++) {
        for (var i = 0; i < S; i++) {
          var dir = dirFromFace(f, (i + 0.5) / S, (j + 0.5) / S);
          var r = rotateDir(dir[0], dir[1], dir[2], a, 0);
          var hit = faceUVFromDir(r[0], r[1], r[2]);
          sampleImage(imgs[hit.face], hit.u * S - 0.5, hit.v * S - 0.5, { wrapX: false }, tmp);
          var o = (j * S + i) << 2;
          d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = tmp[3];
        }
      }
      out.push(dst);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 拼合导出：3×2 与十字
   * ------------------------------------------------------------------ */
  function cubeToSheet(faces, cols, rows, layoutName) {
    var S = faces[0].width;
    var out = makeImage(S * cols, S * rows);
    var lay = LAYOUTS[layoutName];
    for (var f = 0; f < 6; f++) {
      var cell = lay.map[f];
      if (!cell) continue;
      blit(out, faces[f], cell[0] * S, cell[1] * S);
    }
    return out;
  }

  function blit(dst, src, ox, oy) {
    for (var j = 0; j < src.height; j++) {
      var so = j * src.width * 4;
      var to = ((j + oy) * dst.width + ox) * 4;
      dst.data.set(src.data.subarray(so, so + src.width * 4), to);
    }
  }

  /* ------------------------------------------------------------------ *
   * 接缝自检：把 A 面边缘像素与跨过棱后的 B 面像素对比。
   * 由于两个像素在球面上相隔约 1 个纹素，理论上差值应与面内部相邻像素差相当。
   * ------------------------------------------------------------------ */
  function seamReport(faces, samples) {
    var S = faces[0].width;
    samples = samples || Math.min(96, S);
    var res = [];
    var tmpA = [0, 0, 0, 0], tmpB = [0, 0, 0, 0];
    for (var f = 0; f < 6; f++) {
      for (var e = 0; e < 4; e++) {
        var sum = 0, cnt = 0, nbr = -1;
        for (var k = 0; k < samples; k++) {
          var t = (k + 0.5) / samples;
          var i, j, ou, ov;
          if (e === 0) { i = S - 1; j = Math.floor(t * S); ou = (S + 0.5) / S; ov = (j + 0.5) / S; }
          else if (e === 1) { i = 0; j = Math.floor(t * S); ou = -0.5 / S; ov = (j + 0.5) / S; }
          else if (e === 2) { j = 0; i = Math.floor(t * S); ov = -0.5 / S; ou = (i + 0.5) / S; }
          else { j = S - 1; i = Math.floor(t * S); ov = (S + 0.5) / S; ou = (i + 0.5) / S; }
          var dOut = dirFromFace(f, ou, ov);
          var hit = faceUVFromDir(dOut[0], dOut[1], dOut[2]);
          if (hit.face === f) continue;
          if (nbr < 0) nbr = hit.face;
          var bi = Math.min(S - 1, Math.max(0, Math.floor(hit.u * S)));
          var bj = Math.min(S - 1, Math.max(0, Math.floor(hit.v * S)));
          sampleImage(faces[f], i + 0.5, j + 0.5, { wrapX: false }, tmpA);
          sampleImage(faces[hit.face], bi + 0.5, bj + 0.5, { wrapX: false }, tmpB);
          sum += (Math.abs(tmpA[0] - tmpB[0]) + Math.abs(tmpA[1] - tmpB[1]) + Math.abs(tmpA[2] - tmpB[2])) / 3;
          cnt++;
        }
        res.push({
          face: f, edge: e, nbr: nbr,
          diff: cnt ? sum / cnt : 0
        });
      }
    }
    // 同面内部的平均相邻差，作为“基准噪声”
    var base = 0, bn = 0;
    var S2 = faces[0].width;
    for (var ff = 0; ff < 6; ff++) {
      for (var y = 0; y < S2; y += Math.max(1, Math.floor(S2 / 32))) {
        for (var x = 0; x < S2 - 1; x += Math.max(1, Math.floor(S2 / 32))) {
          var a = ((y * S2 + x) << 2), b = a + 4;
          base += (Math.abs(faces[ff].data[a] - faces[ff].data[b]) +
            Math.abs(faces[ff].data[a + 1] - faces[ff].data[b + 1]) +
            Math.abs(faces[ff].data[a + 2] - faces[ff].data[b + 2])) / 3;
          bn++;
        }
      }
    }
    return { edges: res, baseline: bn ? base / bn : 0 };
  }

  /* ------------------------------------------------------------------ *
   * 预览：从视点向外看（内侧视角）渲染立方体贴图
   * ------------------------------------------------------------------ */
  function renderView(ctx, faces, opt) {
    var W = ctx.canvas.width, H = ctx.canvas.height;
    var fovV = (opt.fov || 70) * D2R;
    var yaw = (opt.yaw || 0) * D2R;      // 罗盘方位：0=北
    var pitch = (opt.pitch || 0) * D2R;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var fwd = [cp * sy, sp, -cp * cy];
    var right = [cy, 0, sy];
    var up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0]
    ];
    var tanV = Math.tan(fovV / 2);
    var tanH = tanV * W / H;
    var img = ctx.createImageData(W, H);
    var d = img.data;
    var tmp = [0, 0, 0, 0];
    var S = faces[0].width;
    for (var j = 0; j < H; j++) {
      var sy2 = 1 - 2 * ((j + 0.5) / H);
      for (var i = 0; i < W; i++) {
        var sx2 = 2 * ((i + 0.5) / W) - 1;
        var dx = fwd[0] + right[0] * sx2 * tanH + up[0] * sy2 * tanV;
        var dy = fwd[1] + right[1] * sx2 * tanH + up[1] * sy2 * tanV;
        var dz = fwd[2] + right[2] * sx2 * tanH + up[2] * sy2 * tanV;
        var inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        var hit = faceUVFromDir(dx * inv, dy * inv, dz * inv);
        sampleImage(faces[hit.face], hit.u * S - 0.5, hit.v * S - 0.5, { wrapX: false, nearest: true }, tmp);
        var o = (j * W + i) << 2;
        d[o] = tmp[0]; d[o + 1] = tmp[1]; d[o + 2] = tmp[2]; d[o + 3] = 255;
        if (opt.showEdges) {
          if (hit.u < 1.5 / S || hit.u > 1 - 1.5 / S || hit.v < 1.5 / S || hit.v > 1 - 1.5 / S) {
            d[o] = 255; d[o + 1] = 60; d[o + 2] = 60;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return { fwd: fwd, hit: faceUVFromDir(fwd[0], fwd[1], fwd[2]) };
  }

  var API = {
    TAU: TAU, D2R: D2R, R2D: R2D,
    FACES: FACES, LAYOUTS: LAYOUTS,
    dirFromFace: dirFromFace,
    faceUVFromDir: faceUVFromDir,
    rotateDir: rotateDir,
    dirToEquirectUV: dirToEquirectUV,
    makeImage: makeImage,
    sampleImage: sampleImage,
    canvasToImage: canvasToImage,
    drawToCanvas: drawToCanvas,
    equirectToCube: equirectToCube,
    gridToCube: gridToCube,
    stretchToCube: stretchToCube,
    tileToCube: tileToCube,
    fisheyeToCube: fisheyeToCube,
    rotateCubeY: rotateCubeY,
    rotateQuadrant: rotateQuadrant,
    fitTile: fitTile,
    cubeToSheet: cubeToSheet,
    seamReport: seamReport,
    renderView: renderView
  };

  global.MC = global.MC || {};
  for (var k in API) global.MC[k] = API[k];
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
