/*!
 * Mineraft_MenuPic_Generator — UI 逻辑
 */
(function () {
  'use strict';

  var MC = window.MC;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------------------------------------------------------- *
   * pack_format 表（资源包格式号，纹理路径自 1.13 起未再变动）
   * ---------------------------------------------------------------- */
  var MC_VERSIONS = [
    { v: '26.2 (Chaos Cubed)', f: 88 },
    { v: '26.1 (Tiny Takeover)', f: 84 },
    { v: '1.21.11', f: 75 },
    { v: '1.21.9 – 1.21.10', f: 69 },
    { v: '1.21.7 – 1.21.8', f: 64 },
    { v: '1.21.6', f: 63 },
    { v: '1.21.5', f: 55 },
    { v: '1.21.4', f: 46 },
    { v: '1.21.2 – 1.21.3', f: 42 },
    { v: '1.21 – 1.21.1', f: 34 },
    { v: '1.20.5 – 1.20.6', f: 32 },
    { v: '1.20.3 – 1.20.4', f: 22 },
    { v: '1.20.2', f: 18 },
    { v: '1.20 – 1.20.1', f: 15 },
    { v: '1.19.4', f: 13 },
    { v: '1.19.3', f: 12 },
    { v: '1.19 – 1.19.2', f: 9 },
    { v: '1.18 – 1.18.2', f: 8 },
    { v: '1.17 – 1.17.1', f: 7 },
    { v: '1.16.2 – 1.16.5', f: 6 },
    { v: '1.15 – 1.16.1', f: 5 },
    { v: '1.13 – 1.14.4', f: 4 },
    { v: '1.11 – 1.12.2', f: 3 },
    { v: '1.9 – 1.10.2', f: 2 },
    { v: '1.6.1 – 1.8.9', f: 1 }
  ];

  var EDGE_NAMES = ['右', '左', '上', '下'];

  var state = {
    src: null,          // {width,height,data}
    srcName: '',
    faces: [],          // 最终 6 个面 {width,height,data}
    base: [],           // 未经每面旋转的 6 个面
    rot: [0, 0, 0, 0, 0, 0],
    override: [null, null, null, null, null, null],
    viewYaw: 0,
    viewPitch: 0,
    viewFov: 70,
    spinning: true,
    dirty: true,
    lowRes: false,
    lastFrame: 0,
    genMs: 0
  };

  var faceCanvases = [];

  /* ================================================================ *
   * 工具
   * ================================================================ */
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function imageToBlob(img) {
    return new Promise(function (res, rej) {
      var cv = MC.drawToCanvas(img);
      cv.toBlob(function (b) { b ? res(b) : rej(new Error('PNG 编码失败')); }, 'image/png');
    });
  }

  function blobToImage(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var cv = document.createElement('canvas');
          cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          var cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(im, 0, 0);
          res(MC.canvasToImage(cv));
        };
        im.onerror = function () { rej(new Error('图片解码失败')); };
        im.src = fr.result;
      };
      fr.onerror = function () { rej(new Error('读取文件失败')); };
      fr.readAsDataURL(file);   // data URL 不会污染 canvas，file:// 下也能导出
    });
  }

  function currentMode() {
    var r = document.querySelector('input[name=mode]:checked');
    return r ? r.value : 'equirect';
  }

  /* ================================================================ *
   * 示例全景图：带方位标注，用来验证朝向与镜像
   * ================================================================ */
  function buildSamplePanorama() {
    var W = 2048, H = 1024;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    var sky = g.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, '#0b1836');
    sky.addColorStop(0.55, '#3d7fd6');
    sky.addColorStop(1, '#bfe0f5');
    g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);

    var gnd = g.createLinearGradient(0, H / 2, 0, H);
    gnd.addColorStop(0, '#6f9f4a');
    gnd.addColorStop(0.35, '#4a7a33');
    gnd.addColorStop(1, '#2b3d1f');
    g.fillStyle = gnd; g.fillRect(0, H / 2, W, H / 2);

    // 经纬网格
    g.lineWidth = 2;
    for (var lon = -180; lon < 180; lon += 15) {
      var x = (0.5 + lon / 360) * W;
      g.strokeStyle = (lon % 90 === 0) ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.28)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    for (var lat = -75; lat <= 75; lat += 15) {
      var y = (0.5 - lat / 180) * H;
      g.strokeStyle = (lat === 0) ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.25)';
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    // 方位文字（文字被镜像/翻转时一眼可辨）
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var marks = [
      { lon: 0, t: '北 N', c: '#ff5a4d' },
      { lon: 90, t: '东 E', c: '#4dd2ff' },
      { lon: 180, t: '南 S', c: '#ffe14d' },
      { lon: -90, t: '西 W', c: '#b78cff' }
    ];
    marks.forEach(function (m) {
      var x = (0.5 + m.lon / 360) * W;
      var y = (0.5 - 0.03) * H;
      g.font = '700 84px monospace';
      g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.75)';
      g.strokeText(m.t, x, y); g.fillStyle = m.c; g.fillText(m.t, x, y);
      // 地平线标尺 + 地面阴影，方便看清上下方向
      g.fillStyle = m.c; g.globalAlpha = .35;
      g.fillRect(x - 6, H / 2 - 6, 12, H / 2 + 6);
      g.globalAlpha = 1;
    });

    // 天顶 / 天底
    g.font = '700 64px monospace';
    g.fillStyle = '#fff';
    g.fillText('天顶 ZENITH', W / 2, 70);
    g.fillStyle = '#e8ffe0';
    g.fillText('天底 NADIR', W / 2, H - 70);
    g.font = '700 44px monospace';
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.fillText('等距柱状全景示例 · 水平中心 = 正北 · 2:1', W / 2, H / 2 - 150);
    g.fillText('左 ← → 右', W / 2, H / 2 + 150);

    return MC.canvasToImage(cv);
  }

  /* ================================================================ *
   * 生成流水线
   * ================================================================ */
  function colorFilterCss() {
    var b = +$('f-bright').value, c = +$('f-contrast').value, s = +$('f-sat').value;
    if (b === 100 && c === 100 && s === 100) return '';
    return 'brightness(' + b + '%) contrast(' + c + '%) saturate(' + s + '%)';
  }

  function applyColor(img) {
    var f = colorFilterCss();
    if (!f) return img;
    var cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    cx.filter = f;
    cx.drawImage(MC.drawToCanvas(img), 0, 0);
    return MC.canvasToImage(cv);
  }

  function remapSlots(imgs, swapUD, reverse) {
    if (!swapUD && !reverse) return imgs;
    var order = reverse ? [0, 3, 2, 1] : [0, 1, 2, 3];
    var out = new Array(6);
    for (var i = 0; i < 4; i++) out[i] = imgs[order[i]];
    out[4] = swapUD ? imgs[5] : imgs[4];
    out[5] = swapUD ? imgs[4] : imgs[5];
    return out;
  }

  function generate(sizeOverride) {
    if (!state.src) return;
    var fullS = +$('f-size').value;
    var S = sizeOverride || fullS;
    state.lowRes = (S !== fullS);
    var nearest = $('f-sample').value === 'nearest';
    var mode = currentMode();
    var t0 = performance.now();
    var imgs;

    if (mode === 'equirect') {
      imgs = MC.equirectToCube(state.src, S, {
        nearest: nearest,
        yaw: +$('f-yaw').value,
        pitch: +$('f-pitch').value,
        flipV: $('f-flipv').checked,
        flipH: $('f-fliph').checked
      });
    } else if (mode === 'grid') {
      imgs = MC.gridToCube(state.src, S, { layout: $('f-layout').value });
    } else if (mode === 'stretch') {
      imgs = MC.stretchToCube(state.src, S, {
        fit: $('f-fit-stretch').value,
        rotateStep: $('f-rotstep').checked ? 1 : 0
      });
    } else if (mode === 'tile') {
      imgs = MC.tileToCube(state.src, S, {
        tiles: +$('f-tiles').value,
        mirror: $('f-mirror').checked,
        rotateStep: $('f-trotstep').checked ? 1 : 0,
        nearest: nearest
      });
    } else {
      imgs = MC.fisheyeToCube(state.src, S, {
        fov: +$('f-fov').value,
        rot: +$('f-frot').value,
        nearest: nearest
      });
    }

    imgs = MC.rotateCubeY(imgs, +$('f-ringrot').value);
    imgs = remapSlots(imgs, $('f-swapud').checked, $('f-reverse').checked);

    // 手动覆盖
    for (var f = 0; f < 6; f++) {
      if (state.override[f]) imgs[f] = MC.fitTile(state.override[f], S, 'cover');
    }

    state.base = imgs;
    state.faces = imgs.map(function (im, i) {
      var r = MC.rotateQuadrant(im, state.rot[i]);
      return applyColor(r);
    });

    paintFaces();
    state.dirty = true;
    state.genMs = performance.now() - t0;
    $('gen-stat').textContent = (state.lowRes ? '快速预览 ' : '生成耗时 ') +
      state.genMs.toFixed(0) + ' ms · 每面 ' + S + '×' + S;
  }

  /* ================================================================ *
   * 六个面的缩略图
   * ================================================================ */
  function buildFaceCards() {
    var wrap = $('faces');
    wrap.innerHTML = '';
    faceCanvases = [];
    MC.FACES.forEach(function (fa) {
      var card = document.createElement('div');
      card.className = 'face';
      card.dataset.face = fa.n;
      card.innerHTML =
        '<div class="face-head"><b>' + fa.n + '</b>' +
        '<span class="fname">' + fa.zh + ' ' + fa.key + '</span>' +
        '<span class="sp"></span>' +
        '<button data-act="rot" title="顺时针旋转 90°（Shift 反向）">⟳</button>' +
        '<button data-act="dl" title="下载这一面">⤓</button></div>' +
        '<canvas class="face-canvas"></canvas>' +
        '<div class="face-tag">panorama_' + fa.n + '.png</div>';
      wrap.appendChild(card);

      var canvas = card.querySelector('canvas');
      faceCanvases.push(canvas);

      card.querySelector('[data-act=rot]').addEventListener('click', function (ev) {
        var step = ev.shiftKey ? -1 : 1;
        state.rot[fa.n] = ((state.rot[fa.n] + step) % 4 + 4) % 4;
        // 已经生成好的面直接旋转（与 generate() 里的 rot 语义一致）
        state.faces[fa.n] = MC.rotateQuadrant(state.faces[fa.n], step);
        paintOne(fa.n);
        state.dirty = true;
      });
      card.querySelector('[data-act=dl]').addEventListener('click', function () {
        imageToBlob(state.faces[fa.n]).then(function (b) {
          download(b, 'panorama_' + fa.n + '.png');
        });
      });
      canvas.addEventListener('click', function () {
        imageToBlob(state.faces[fa.n]).then(function (b) {
          download(b, 'panorama_' + fa.n + '.png');
        });
      });

      // 拖图覆盖
      card.addEventListener('dragover', function (e) {
        e.preventDefault(); card.classList.add('drop-over');
      });
      card.addEventListener('dragleave', function () { card.classList.remove('drop-over'); });
      card.addEventListener('drop', function (e) {
        e.preventDefault(); card.classList.remove('drop-over');
        var file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        blobToImage(file).then(function (img) {
          state.override[fa.n] = img;
          state.rot[fa.n] = 0;
          generate();
          toast('已覆盖 panorama_' + fa.n + '（双击标题可清除）');
        }).catch(function (err) { toast(err.message, true); });
      });
      card.querySelector('.face-head').addEventListener('dblclick', function () {
        if (!state.override[fa.n]) return;
        state.override[fa.n] = null;
        generate();
        toast('已恢复自动生成的 panorama_' + fa.n);
      });
    });
  }

  function paintOne(f) {
    var cv = faceCanvases[f];
    var img = state.faces[f];
    if (!cv || !img) return;
    if (cv.width !== img.width) { cv.width = img.width; cv.height = img.height; }
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var id = cx.createImageData(img.width, img.height);
    id.data.set(img.data);
    cx.putImageData(id, 0, 0);
    var tag = cv.parentNode.querySelector('.face-tag');
    tag.textContent = 'panorama_' + f + '.png' +
      (state.override[f] ? ' · 手动覆盖（双击面标题恢复）' : '') +
      (state.rot[f] ? ' · 已旋转 ' + (state.rot[f] * 90) + '°' : '');
    tag.style.color = state.override[f] ? 'var(--err)' : '';
  }

  function paintFaces() {
    for (var f = 0; f < 6; f++) paintOne(f);
  }

  /* ================================================================ *
   * 预览
   * ================================================================ */
  var viewCv = null, viewCtx = null;

  function sizeView() {
    var rect = viewCv.parentNode.getBoundingClientRect();
    var w = Math.max(320, Math.min(900, Math.round(rect.width)));
    var h = Math.round(w * 9 / 16);
    if (viewCv.width !== w || viewCv.height !== h) {
      viewCv.width = w; viewCv.height = h;
    }
  }

  var COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

  function drawView() {
    if (!state.faces.length) return;
    sizeView();
    var hit = MC.renderView(viewCtx, state.faces, {
      fov: state.viewFov, yaw: state.viewYaw, pitch: state.viewPitch,
      showEdges: $('v-seams').checked
    });
    var deg = ((state.viewYaw % 360) + 360) % 360;
    var dir = COMPASS[Math.round(deg / 45) % 8];
    $('hud').textContent = '朝向 ' + dir + ' ' + deg.toFixed(0) + '° · 俯仰 ' +
      state.viewPitch.toFixed(0) + '° · 视场 ' + state.viewFov + '° · 面 ' +
      hit.hit.face + ' (' + MC.FACES[hit.hit.face].zh + ')';
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (state.spinning) {
      state.viewYaw += 0.18;
      state.dirty = true;
    }
    // 自动旋转时限制到 ~30fps，避免低端设备风扇狂转
    if (state.dirty && (!state.spinning || ts - state.lastFrame > 33)) {
      state.lastFrame = ts;
      state.dirty = false;
      drawView();
    }
  }

  /* ================================================================ *
   * 导出
   * ================================================================ */
  function ensureFull() {
    if (!state.faces.length) { toast('还没有可导出的内容', true); return false; }
    if (state.lowRes) generate();
    return true;
  }

  function faceFileObjects() {
    return Promise.all(state.faces.map(function (img, i) {
      return imageToBlob(img).then(function (b) {
        return { name: 'panorama_' + i + '.png', blob: b };
      });
    }));
  }

  function blobToU8(blob) {
    return blob.arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function packMcmeta() {
    var idx = +$('f-mcver').value;
    var ver = MC_VERSIONS[idx];
    var fmt = ver.f;
    var pack = { pack_format: fmt, description: $('f-desc').value || '' };
    if ($('f-range').checked) {
      if (fmt >= 69) {
        pack.min_format = 4;
        pack.max_format = Math.max(fmt, MC_VERSIONS[0].f);
      } else if (fmt >= 18) {
        pack.supported_formats = { min_inclusive: 4, max_inclusive: Math.max(fmt, 64) };
      }
    }
    return JSON.stringify({ pack: pack }, null, 2) + '\n';
  }

  function packIcon() {
    var S = 128;
    var img = MC.fitTile(state.faces[0], S, 'cover');
    return imageToBlob(img);
  }

  function exportZip() {
    if (!ensureFull()) return;
    var dir = 'assets/minecraft/textures/gui/title/background/';
    Promise.all([faceFileObjects(), packIcon()]).then(function (r) {
      var faces = r[0], icon = r[1];
      return Promise.all([
        Promise.all(faces.map(function (f) { return blobToU8(f.blob); })),
        blobToU8(icon)
      ]).then(function (bufs) {
        var files = [
          { name: 'pack.mcmeta', data: packMcmeta() },
          { name: 'pack.png', data: bufs[1] }
        ];
        bufs[0].forEach(function (u8, i) {
          files.push({ name: dir + 'panorama_' + i + '.png', data: u8 });
        });
        var zip = MC.makeZip(files);
        var safe = ($('f-packname').value || 'panorama').replace(/[\\/:*?"<>|]/g, '_');
        download(zip, safe + '.zip');
        toast('资源包已导出：解压到 .minecraft/resourcepacks/ 即可');
      });
    }).catch(function (e) { toast(e.message, true); });
  }

  function exportFacesZip() {
    if (!ensureFull()) return;
    faceFileObjects().then(function (faces) {
      return Promise.all(faces.map(function (f) { return blobToU8(f.blob); }))
        .then(function (bufs) {
          var files = bufs.map(function (u8, i) {
            return { name: 'panorama_' + i + '.png', data: u8 };
          });
          download(MC.makeZip(files), 'panorama_faces.zip');
        });
    }).catch(function (e) { toast(e.message, true); });
  }

  function exportSheet(which) {
    if (!ensureFull()) return;
    var img = which === 'cross'
      ? MC.cubeToSheet(state.faces, 4, 3, 'cross-h')
      : MC.cubeToSheet(state.faces, 3, 2, 'mc-3x2');
    imageToBlob(img).then(function (b) {
      download(b, which === 'cross' ? 'panorama_cross.png' : 'panorama_3x2.png');
    });
  }

  /* ================================================================ *
   * 接缝自检
   * ================================================================ */
  function runSeamCheck() {
    if (!ensureFull()) return;
    var rep = MC.seamReport(state.faces, 96);
    var base = rep.baseline;
    var threshold = Math.max(6, base * 1.8 + 1.5);
    var worst = 0;
    rep.edges.forEach(function (e) { if (e.diff > worst) worst = e.diff; });

    var byFace = [];
    rep.edges.forEach(function (e) {
      byFace[e.face] = byFace[e.face] || [];
      byFace[e.face][e.edge] = e;
    });

    var html = '<p>面内相邻像素平均差异（基准噪声）：<b>' + base.toFixed(2) +
      '</b> · 判定阈值：<b>' + threshold.toFixed(2) + '</b></p>';
    html += '<table><tr><th>面</th><th>方向</th>' +
      EDGE_NAMES.map(function (n) { return '<th>' + n + '</th>'; }).join('') + '</tr>';
    for (var f = 0; f < 6; f++) {
      html += '<tr><td><b>' + f + '</b> ' + MC.FACES[f].zh + '</td><td>' + MC.FACES[f].key + '</td>';
      for (var e = 0; e < 4; e++) {
        var rec = byFace[f][e];
        var cls = rec.diff <= threshold ? 'ok' : 'bad';
        html += '<td class="' + cls + '">' + rec.diff.toFixed(1) +
          '<span class="muted"> →' + rec.nbr + '</span></td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    var verdict = worst <= threshold
      ? '<p class="ok">✓ 所有接缝均低于阈值，立方体贴图自洽，游戏里不会出现明显裂缝。</p>'
      : '<p class="bad">✗ 最差接缝 ' + worst.toFixed(1) + ' 明显高于基准，说明至少有一个面方向不对：' +
        '若是“拼合图拆分”模式，先检查布局；也可在“高级”里试 上下互换 / 环向反转。</p>';
    $('seam-out').innerHTML = html + verdict;
  }

  /* ================================================================ *
   * 源图预览与网格叠加
   * ================================================================ */
  function drawSource() {
    var cv = $('src-preview');
    var img = state.src;
    if (!img) return;
    var maxW = 520;
    var scale = Math.min(1, maxW / img.width);
    cv.width = Math.max(1, Math.round(img.width * scale));
    cv.height = Math.max(1, Math.round(img.height * scale));
    var cx = cv.getContext('2d', { willReadFrequently: true });
    var tmpCv = MC.drawToCanvas(img);
    cx.drawImage(tmpCv, 0, 0, cv.width, cv.height);
    drawGridOverlay();
  }

  function drawGridOverlay() {
    var ov = $('grid-overlay');
    var src = $('src-preview');
    if (currentMode() !== 'grid' || !state.src) { ov.classList.add('hidden'); return; }
    ov.classList.remove('hidden');
    ov.width = src.width; ov.height = src.height;
    var g = ov.getContext('2d');
    g.clearRect(0, 0, ov.width, ov.height);
    var lay = MC.LAYOUTS[$('f-layout').value];
    if (!lay) return;
    var cw = ov.width / lay.cols, ch = ov.height / lay.rows;
    for (var f = 0; f < 6; f++) {
      var cell = lay.map[f];
      if (!cell) continue;
      var x = cell[0] * cw, y = cell[1] * ch;
      g.strokeStyle = '#6cc349'; g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(x + 4, y + 4, 34, 24);
      g.fillStyle = '#8fd66a';
      g.font = '700 15px monospace';
      g.fillText(String(f), x + 12, y + 22);
      g.fillStyle = 'rgba(108,195,73,.85)';
      g.font = '600 12px monospace';
      g.fillText(MC.FACES[f].zh, x + 44, y + 22);
    }
    // 空位提醒
    g.strokeStyle = 'rgba(232,96,76,.5)';
    for (var r = 0; r < lay.rows; r++) {
      for (var c = 0; c < lay.cols; c++) {
        var used = false;
        for (var k = 0; k < 6; k++) {
          var cc = lay.map[k];
          if (cc && cc[0] === c && cc[1] === r) used = true;
        }
        if (!used) {
          g.setLineDash([5, 4]);
          g.strokeRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
          g.setLineDash([]);
        }
      }
    }
  }

  function setSource(img, name) {
    state.src = img;
    state.srcName = name || '';
    state.override = [null, null, null, null, null, null];
    state.rot = [0, 0, 0, 0, 0, 0];
    var info = $('src-info');
    var ratio = img.width / img.height;
    var cls = 'src-info ok', extra = '';
    if (currentMode() === 'equirect') {
      var d = Math.abs(ratio - 2);
      if (d < 0.06) extra = ' · 比例 2:1，适合球面投影 ✓';
      else if (d < 0.25) extra = ' · 比例 ' + ratio.toFixed(2) + ':1，接近 2:1，可接受';
      else { extra = ' · ⚠ 比例 ' + ratio.toFixed(2) + ':1，不是 2:1，等距柱状全景建议 2:1'; cls = 'src-info bad'; }
    }
    info.className = cls;
    info.textContent = (name ? name + ' · ' : '') + img.width + '×' + img.height + extra;
    $('src-wrap').classList.remove('hidden');
    drawSource();
    generate();
  }

  /* ================================================================ *
   * 初始化与事件
   * ================================================================ */
  function syncGroups() {
    var m = currentMode();
    Array.prototype.forEach.call(document.querySelectorAll('.group[data-for]'), function (g) {
      g.classList.toggle('hidden', g.dataset.for !== m);
    });
  }

  function initSelects() {
    var lay = $('f-layout');
    lay.innerHTML = '';
    Object.keys(MC.LAYOUTS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = MC.LAYOUTS[k].zh;
      lay.appendChild(o);
    });

    var ver = $('f-mcver');
    ver.innerHTML = '';
    MC_VERSIONS.forEach(function (v, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = v.v + '  →  pack_format ' + v.f;
      ver.appendChild(o);
      if (v.f === 15) o.selected = true;   // 默认 1.20–1.20.1
    });
  }

  function bind() {
    // 模式切换
    Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function (r) {
      r.addEventListener('change', function () {
        syncGroups();
        drawGridOverlay();
        if (state.src) {
          var info = $('src-info');
          if (r.value === 'equirect') {
            var ratio = state.src.width / state.src.height;
            if (Math.abs(ratio - 2) > 0.25) info.className = 'src-info bad';
          }
          generate();
        }
      });
    });

    // 文件输入
    var fi = $('file-input');
    $('drop').addEventListener('click', function () { fi.click(); });
    $('drop').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
    });
    fi.addEventListener('change', function () {
      if (fi.files && fi.files[0]) loadFile(fi.files[0]);
      fi.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (t) {
      $('drop').addEventListener(t, function (e) {
        e.preventDefault(); $('drop').classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      $('drop').addEventListener(t, function (e) {
        e.preventDefault(); $('drop').classList.remove('over');
      });
    });
    $('drop').addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') === 0) {
          loadFile(items[i].getAsFile());
          break;
        }
      }
    });

    $('btn-sample').addEventListener('click', function () {
      setSource(buildSamplePanorama(), '示例全景图（代码生成）');
      toast('已载入示例全景图：看预览里的 N/E/S/W 是否正确朝向你');
    });
    $('btn-clear').addEventListener('click', function () {
      state.src = null; state.faces = []; state.base = [];
      $('src-wrap').classList.add('hidden');
      $('src-info').className = 'src-info muted';
      $('src-info').textContent = '尚未载入图片';
      state.dirty = true;
      drawView();
    });

    // 参数：滑块先出低分辨率快速预览，停手后再出全分辨率
    var fastTimer = null, fullTimer = null;
    function later() {
      clearTimeout(fastTimer); clearTimeout(fullTimer);
      fastTimer = setTimeout(function () { generate(256); }, 35);
      fullTimer = setTimeout(function () { generate(); }, 340);
    }
    ['f-yaw', 'f-pitch', 'f-tiles', 'f-fov', 'f-frot', 'f-bright', 'f-contrast', 'f-sat']
      .forEach(function (id) {
        $(id).addEventListener('input', function () {
          updateValLabels();
          state.dirty = true;
          later();
        });
      });
    ['f-size', 'f-sample', 'f-layout', 'f-fit-stretch', 'f-ringrot'].forEach(function (id) {
      $(id).addEventListener('change', function () { generate(); });
    });
    ['f-rotstep', 'f-trotstep', 'f-mirror', 'f-flipv', 'f-fliph', 'f-swapud', 'f-reverse']
      .forEach(function (id) {
        $(id).addEventListener('change', function () { generate(); });
      });
    $('f-layout').addEventListener('change', drawGridOverlay);

    // 预览交互
    viewCv = $('view');
    viewCtx = viewCv.getContext('2d', { willReadFrequently: true });
    var dragging = false, lx = 0, ly = 0;
    viewCv.addEventListener('pointerdown', function (e) {
      dragging = true; lx = e.clientX; ly = e.clientY;
      viewCv.setPointerCapture(e.pointerId);
      viewCv.classList.add('drag');
    });
    viewCv.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      state.viewYaw -= dx * 0.25;
      state.viewPitch = Math.max(-89, Math.min(89, state.viewPitch - dy * 0.25));
      state.dirty = true;
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      viewCv.addEventListener(t, function () {
        dragging = false; viewCv.classList.remove('drag');
      });
    });
    viewCv.addEventListener('wheel', function (e) {
      e.preventDefault();
      state.viewFov = Math.max(30, Math.min(120, state.viewFov + (e.deltaY > 0 ? 3 : -3)));
      $('v-fov').value = state.viewFov;
      $('v-fovval').textContent = state.viewFov + '°';
      state.dirty = true;
    }, { passive: false });

    $('v-spin').addEventListener('change', function () {
      state.spinning = this.checked; state.dirty = true;
    });
    $('v-seams').addEventListener('change', function () { state.dirty = true; });
    $('v-fov').addEventListener('input', function () {
      state.viewFov = +this.value;
      $('v-fovval').textContent = state.viewFov + '°';
      state.dirty = true;
    });
    $('v-reset').addEventListener('click', function () {
      state.viewYaw = 0; state.viewPitch = 0;
      state.viewFov = 70;
      $('v-fov').value = 70; $('v-fovval').textContent = '70°';
      state.dirty = true;
    });

    // 导出
    $('btn-zip').addEventListener('click', exportZip);
    $('btn-faces').addEventListener('click', exportFacesZip);
    $('btn-sheet').addEventListener('click', function () { exportSheet('3x2'); });
    $('btn-cross').addEventListener('click', function () { exportSheet('cross'); });
    $('btn-seam').addEventListener('click', runSeamCheck);

    window.addEventListener('resize', function () { state.dirty = true; });
  }

  function loadFile(file) {
    if (!file) return;
    blobToImage(file).then(function (img) {
      if (img.width < 32 || img.height < 32) throw new Error('图片太小了');
      setSource(img, file.name);
      toast('已载入 ' + file.name + '（' + img.width + '×' + img.height + '）');
    }).catch(function (e) { toast(e.message || '图片载入失败', true); });
  }

  function updateValLabels() {
    $('v-yaw').textContent = $('f-yaw').value + '°';
    $('v-pitch').textContent = $('f-pitch').value + '°';
    $('v-tiles').textContent = $('f-tiles').value + ' × ' + $('f-tiles').value;
    $('v-fov').textContent = $('f-fov').value + '°';
    $('v-frot').textContent = $('f-frot').value + '°';
    $('v-bright').textContent = $('f-bright').value + '%';
    $('v-contrast').textContent = $('f-contrast').value + '%';
    $('v-sat').textContent = $('f-sat').value + '%';
  }

  /* ---------------------------------------------------------------- *
   * URL 参数：方便把一套配置做成书签/分享链接，也方便自动化截图测试。
   * 例：index.html?mode=tile&fov=100&pitch=85&spin=0&seams=1&size=512
   * ---------------------------------------------------------------- */
  function applyUrlParams() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return { demo: true }; }

    var mode = q.get('mode');
    if (mode) {
      var r = document.querySelector('input[name=mode][value="' + mode + '"]');
      if (r) r.checked = true;
    }
    var size = q.get('size');
    if (size && /^\d+$/.test(size)) $('f-size').value = size;
    if (q.has('viewyaw')) state.viewYaw = +q.get('viewyaw');
    if (q.has('pitch')) state.viewPitch = Math.max(-89, Math.min(89, +q.get('pitch')));
    if (q.has('fov')) state.viewFov = Math.max(30, Math.min(120, +q.get('fov')));
    if (q.get('spin') === '0') state.spinning = false;
    if (q.get('seams') === '1') $('v-seams').checked = true;

    // 生成参数（与面板同名，f- 前缀可省略）
    [['panoyaw', 'f-yaw'], ['panopitch', 'f-pitch'], ['tiles', 'f-tiles'],
    ['fisheyefov', 'f-fov'], ['layout', 'f-layout'], ['ringrot', 'f-ringrot']]
      .forEach(function (pair) {
        if (q.has(pair[0])) $(pair[1]).value = q.get(pair[0]);
      });

    return { demo: q.get('demo') !== '0', check: q.get('check') === '1' };
  }

  function init() {
    // 注意顺序：先填充下拉框，再应用 URL 参数，否则 layout / mcver 之类的
    // 动态选项在赋值时还不存在，设置会被静默丢弃。
    initSelects();
    var url = applyUrlParams();
    buildFaceCards();
    bind();
    syncGroups();
    updateValLabels();
    $('v-fov').value = state.viewFov;
    $('v-fovval').textContent = state.viewFov + '°';
    $('v-spin').checked = state.spinning;
    requestAnimationFrame(loop);

    // 首次自动载入示例，避免打开就是空白
    if (url.demo) {
      setSource(buildSamplePanorama(), '示例全景图（代码生成）');
      if (url.check) runSeamCheck();
      toast('已自动载入示例全景图，点“生成示例全景图”可随时重置');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
