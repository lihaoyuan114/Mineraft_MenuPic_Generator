/*
 * 自检脚本（Node，无第三方依赖）：
 *   node tools/selftest.cjs
 *
 * 验证内容：
 *   1. dirFromFace / faceUVFromDir 互为逆运算
 *   2. 12 条棱的相邻面关系与 docs/panorama-format.md 中的约定一致
 *   3. 用平滑全景图做投影后，24 条接缝的差异与面内相邻像素差异同量级（=> 无缝）
 *   4. 等距柱状投影是保真的（球面 -> 立方体 -> 反查方向，颜色一致）
 *   5. ZIP 打包器产出可被标准解压工具读取的归档
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const MC = require(path.join(__dirname, '..', 'js', 'cubemap.js'));
const ZIP = require(path.join(__dirname, '..', 'js', 'zip.js'));

let failed = 0;
function ok(cond, name, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (detail ? '  ' + detail : ''));
  if (!cond) failed++;
}

const F = MC.FACES;

/* ---------- 1. 面内坐标 <-> 方向 互逆 ---------- */
console.log('\n[1] 面内坐标 <-> 方向 互逆');
{
  let maxErr = 0;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 400; k++) {
      const u = (k % 20 + 0.5) / 20, v = (Math.floor(k / 20) + 0.5) / 20;
      const d = MC.dirFromFace(f, u, v);
      const hit = MC.faceUVFromDir(d[0], d[1], d[2]);
      maxErr = Math.max(maxErr, Math.abs(hit.u - u), Math.abs(hit.v - v), Math.abs(hit.face - f));
    }
  }
  ok(maxErr < 1e-9, '2400 个采样点往返误差 < 1e-9', 'maxErr=' + maxErr.toExponential(2));
}

/* ---------- 2. 棱相邻关系 ---------- */
console.log('\n[2] 12 条棱的相邻面（right/left/top/bottom）');
{
  // 期望表：由 dir(u,v)=F+R(2u-1)+U(1-2v) 推导，并与 Minecraft Wiki
  // “4 的下边贴 0 的上边、5 的上边贴 0 的下边”一致
  const expected = {
    0: { right: 1, left: 3, top: 4, bottom: 5 },
    1: { right: 2, left: 0, top: 4, bottom: 5 },
    2: { right: 3, left: 1, top: 4, bottom: 5 },
    3: { right: 0, left: 2, top: 4, bottom: 5 },
    4: { right: 1, left: 3, top: 2, bottom: 0 },
    5: { right: 1, left: 3, top: 0, bottom: 2 }
  };
  const S = 64;
  const got = {};
  let edgePosOk = true;
  for (let f = 0; f < 6; f++) {
    got[f] = {};
    for (let e = 0; e < 4; e++) {
      let i, j, ou, ov;
      const t = 0.5;
      if (e === 0) { i = S - 1; j = Math.floor(t * S); ou = (S + 0.5) / S; ov = (j + 0.5) / S; }
      else if (e === 1) { i = 0; j = Math.floor(t * S); ou = -0.5 / S; ov = (j + 0.5) / S; }
      else if (e === 2) { j = 0; i = Math.floor(t * S); ov = -0.5 / S; ou = (i + 0.5) / S; }
      else { j = S - 1; i = Math.floor(t * S); ov = (S + 0.5) / S; ou = (i + 0.5) / S; }
      const d = MC.dirFromFace(f, ou, ov);
      const hit = MC.faceUVFromDir(d[0], d[1], d[2]);
      got[f][['right', 'left', 'top', 'bottom'][e]] = hit.face;
      // 跨过棱后应该正好落在邻面的边缘半像素内
      const nearEdge = Math.min(hit.u, 1 - hit.u, hit.v, 1 - hit.v);
      if (nearEdge > 1.2 / S) edgePosOk = false;
    }
  }
  let allOk = true;
  for (let f = 0; f < 6; f++) {
    for (const e of ['right', 'left', 'top', 'bottom']) {
      if (got[f][e] !== expected[f][e]) allOk = false;
    }
  }
  ok(allOk, '24 条棱的邻面与约定表完全一致');
  if (!allOk) console.log('    实际:', JSON.stringify(got));
  ok(edgePosOk, '跨棱一步后落在邻面边缘半像素带内');
}

/* ---------- 3. 平滑全景图 -> 立方体，接缝应无差异 ---------- */
console.log('\n[3] 平滑全景投影后的 24 条接缝');
{
  const W = 512, H = 256;
  const src = MC.makeImage(W, H);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      // 低频平滑函数（全图连续、按经度严格 360° 周期）
      const r = 128 + 70 * Math.sin(lon) * Math.cos(lat);
      const g = 128 + 70 * Math.cos(2 * lon) * Math.cos(lat) * Math.cos(lat);
      const b = 128 + 70 * Math.sin(3 * lon + lat) * Math.cos(lat);
      const o = (j * W + i) << 2;
      src.data[o] = r; src.data[o + 1] = g; src.data[o + 2] = b; src.data[o + 3] = 255;
    }
  }
  const faces = MC.equirectToCube(src, 128, {});
  const rep = MC.seamReport(faces, 128);
  const worst = Math.max(...rep.edges.map(e => e.diff));
  ok(worst < Math.max(2, rep.baseline * 1.5),
    '所有接缝差异与面内噪声同量级',
    'worst=' + worst.toFixed(3) + ' baseline=' + rep.baseline.toFixed(3));

  // 反例：把某两个面换错，接缝差异必须显著变大（说明该检验有效）
  const bad = faces.slice();
  const t = bad[0]; bad[0] = bad[1]; bad[1] = t;
  const badRep = MC.seamReport(bad, 128);
  const badWorst = Math.max(...badRep.edges.map(e => e.diff));
  ok(badWorst > worst * 3, '对照实验：故意交换两个面后接缝差异显著变大',
    'bad=' + badWorst.toFixed(2));
}

/* ---------- 4. 球面投影保真度 ---------- */
console.log('\n[4] 球面投影保真度（球面 -> 立方体 -> 反查）');
{
  const W = 1024, H = 512;
  const src = MC.makeImage(W, H);
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      // 带限（平滑）纹理：任何方位/镜像/偏移错误都会立刻放大颜色差，
      // 而平滑信号在降采样时不会产生混叠噪声
      const o = (j * W + i) << 2;
      src.data[o] = 128 + 100 * Math.sin(lon) * Math.cos(lat);
      src.data[o + 1] = 128 + 100 * Math.cos(2 * lon) * Math.cos(lat) * Math.cos(lat);
      src.data[o + 2] = 128 + 100 * Math.sin(3 * lon + 2 * lat) * Math.cos(lat);
      src.data[o + 3] = 255;
    }
  }
  const S = 256;
  const faces = MC.equirectToCube(src, S, {});
  const tmp = [0, 0, 0, 0], ref = [0, 0, 0, 0];
  let worst = 0, n = 0;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 200; k++) {
      const u = (k % 20 + 0.5) / 20, v = (Math.floor(k / 20) + 0.5) / 20;
      const d = MC.dirFromFace(f, u, v);
      const uv = MC.dirToEquirectUV(d[0], d[1], d[2]);
      MC.sampleImage(src, uv[0] * W - 0.5, uv[1] * H - 0.5, {}, ref);
      MC.sampleImage(faces[f], u * S - 0.5, v * S - 0.5, { wrapX: false }, tmp);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(tmp[c] - ref[c]));
      n++;
    }
  }
  // 双线性降采样 + 8bit 量化，误差应当很小；若朝向/镜像/偏移有错会达到数十
  ok(worst < 6, n + ' 个方向上的颜色与源全景一致', 'maxDiff=' + worst.toFixed(2));
}

/* ---------- 5. ZIP ---------- */
console.log('\n[5] ZIP 打包器');
{
  const enc = s => new TextEncoder().encode(s);
  ok(ZIP.crc32(enc('123456789')) === 0xCBF43926, 'CRC-32 校验向量 "123456789" = 0xCBF43926',
    '0x' + ZIP.crc32(enc('123456789')).toString(16).toUpperCase());

  const files = [
    { name: 'pack.mcmeta', data: '{"pack":{"pack_format":15}}\n' },
    { name: 'assets/minecraft/textures/gui/title/background/panorama_0.png', data: enc('\x89PNG\r\n\x1a\nfake') }
  ];
  const blob = ZIP.makeZip(files);
  const out = path.join(os.tmpdir(), 'mc_menu_pic_selftest.zip');
  blob.arrayBuffer().then(ab => {
    fs.writeFileSync(out, Buffer.from(ab));
    let zipOk = false, detail = 'python3 不可用，跳过解压校验';
    try {
      const py = "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print('|'.join(z.namelist()));print(z.testzip() or 'CRC-OK');sys.exit(0 if z.testzip() is None else 1)";
      const res = execFileSync('python3', ['-c', py, out], { encoding: 'utf8' }).trim().split('\n');
      zipOk = res[0].split('|').join(',') === files.map(f => f.name).join(',') && res[1] === 'CRC-OK';
      detail = 'files=' + res[0] + ' ' + res[1];
    } catch (e) {
      detail = 'python3 校验失败: ' + (e.message || e);
    }
    ok(zipOk, '标准 zipfile 可读取且 CRC 正确', detail);

    /* ---------- 6. 其它模式不崩溃 ---------- */
    console.log('\n[6] 其它模式基本可用性');
    {
      const src = MC.makeImage(300, 200);
      for (let i = 0; i < src.data.length; i++) src.data[i] = 255;
      const a = MC.stretchToCube(src, 32, { fit: 'cover', rotateStep: 1 });
      ok(a.length === 6 && a[0].width === 32, '直接覆盖：输出 6 面 32×32');
      const b = MC.tileToCube(src, 32, { tiles: 2, mirror: true });
      ok(b.length === 6, '复制平铺：输出 6 面');
      const c = MC.gridToCube(src, 32, { layout: 'cross-h' });
      ok(c.length === 6 && c[0].width === 32, '十字拆分：输出 6 面 32×32');
      const d = MC.fisheyeToCube(src, 32, { fov: 180 });
      ok(d.length === 6, '鱼眼转全景：输出 6 面');
      const e = MC.rotateCubeY(c, 1);
      ok(e.length === 6, '整体水平旋转 90°');
    }

    console.log('\n' + (failed ? '\u2717 失败 ' + failed + ' 项' : '\u2713 全部通过'));
    process.exit(failed ? 1 : 0);
  });
}
