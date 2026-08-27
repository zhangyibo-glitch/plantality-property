const IMG_LY_ESM = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

const defaults = {
  h: 6.42, e: 3.38, x: 5.41, a: 5.79, c: 5.74, o: 5.36,
  subjectOpacity: 36, bloomOverlap: 68, stippleDensity: 58
};

const traits = [
  { key: 'h', name: 'Honesty–Humility', facet: '(Fairness/Sincerity)', high: 'sincere', low: 'deceitful' },
  { key: 'e', name: 'Emotionality', facet: '(Dependence)', high: 'dependent', low: 'independent' },
  { key: 'x', name: 'eXtraversion', facet: '(Social Boldness)', high: 'proactive', low: 'reserved' },
  { key: 'a', name: 'Agreeableness', facet: '(Flexibility)', high: 'accommodating', low: 'stubborn' },
  { key: 'c', name: 'Conscientiousness', facet: '(Organization)', high: 'organized', low: 'disorganized' },
  { key: 'o', name: 'Openness to Experience', facet: '(Creativity)', high: 'imaginative', low: 'conventional' }
];

const state = {
  sourceFile: null,
  sourceImage: null,
  processedImage: null,
  bounds: null,
  mode: 'cutout',
  preset: 'mist',
  theme: '#6651a3',
  autoTheme: true,
  subjectOpacity: defaults.subjectOpacity / 100,
  bloomOverlap: defaults.bloomOverlap / 100,
  stippleDensity: defaults.stippleDensity / 100,
  scores: { h: defaults.h, e: defaults.e, x: defaults.x, a: defaults.a, c: defaults.c, o: defaults.o },
  processing: false,
  renderQueued: false,
  lastProcessToken: 0
};

const dom = {
  dropzone: document.querySelector('#dropzone'),
  dropzoneTitle: document.querySelector('#dropzoneTitle'),
  dropzoneMeta: document.querySelector('#dropzoneMeta'),
  photoInput: document.querySelector('#photoInput'),
  preview: document.querySelector('#referencePreview'),
  canvas: document.querySelector('#renderCanvas'),
  overlay: document.querySelector('#processingOverlay'),
  processingTitle: document.querySelector('#processingTitle'),
  processingDetail: document.querySelector('#processingDetail'),
  stageStatus: document.querySelector('#stageStatus'),
  exportButton: document.querySelector('#exportButton'),
  cutoutHint: document.querySelector('#cutoutHint'),
  customColor: document.querySelector('#customColor')
};

dom.exportButton.disabled = true;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, amount) => a + (b - a) * amount;

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function mixColors(hexA, hexB, amount) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  return rgbToHex(lerp(a.r, b.r, amount), lerp(a.g, b.g, amount), lerp(a.b, b.b, amount));
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function hashState() {
  const color = parseInt(state.theme.slice(1), 16);
  return Math.floor(Object.values(state.scores).reduce((sum, value, index) => sum + value * (index + 17) * 101, color)) >>> 0;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try { return await loadImage(url); }
  finally { URL.revokeObjectURL(url); }
}

function setProcessing(visible, title = '', detail = '') {
  state.processing = visible;
  dom.overlay.classList.toggle('visible', visible);
  if (title) dom.processingTitle.textContent = title;
  if (detail) dom.processingDetail.textContent = detail;
  dom.exportButton.disabled = visible || !state.sourceImage;
}

function setStatus(message) { dom.stageStatus.textContent = message; }

function getCropBounds(image) {
  const sample = document.createElement('canvas');
  const maxSide = 420;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  sample.width = Math.max(1, Math.round(sourceWidth * scale));
  sample.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = sample.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let minX = sample.width, minY = sample.height, maxX = 0, maxY = 0, count = 0;
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const alpha = pixels[(y * sample.width + x) * 4 + 3];
      if (alpha > 28) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); count += 1;
      }
    }
  }
  if (!count) return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const pad = 5;
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  const width = Math.min(sample.width, maxX + pad) - x;
  const height = Math.min(sample.height, maxY + pad) - y;
  return { x: x / scale, y: y / scale, width: width / scale, height: height / scale };
}

async function classicCutout(image) {
  const maxSide = 560;
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const work = document.createElement('canvas');
  work.width = width; work.height = height;
  const context = work.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  const total = width * height;
  const background = new Uint8Array(total);
  const queued = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  const cornerRadius = Math.max(3, Math.round(Math.min(width, height) * .035));
  const cornerSamples = [];
  const corners = [[0, 0], [width - cornerRadius, 0], [0, height - cornerRadius], [width - cornerRadius, height - cornerRadius]];
  for (const [startX, startY] of corners) {
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = startY; y < Math.min(height, startY + cornerRadius); y += 2) {
      for (let x = startX; x < Math.min(width, startX + cornerRadius); x += 2) {
        const offset = (y * width + x) * 4;
        r += pixels[offset]; g += pixels[offset + 1]; b += pixels[offset + 2]; count += 1;
      }
    }
    cornerSamples.push({ r: r / count, g: g / count, b: b / count });
  }

  const distanceToBackground = (index) => {
    const offset = index * 4;
    let minimum = Infinity;
    for (const sample of cornerSamples) {
      const dr = pixels[offset] - sample.r;
      const dg = pixels[offset + 1] - sample.g;
      const db = pixels[offset + 2] - sample.b;
      minimum = Math.min(minimum, Math.sqrt(dr * dr + dg * dg + db * db));
    }
    return minimum;
  };

  const push = (index) => {
    if (queued[index]) return;
    queued[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) { push(x); push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { push(y * width); push(y * width + width - 1); }

  const threshold = 72;
  while (head < tail) {
    const index = queue[head++];
    if (distanceToBackground(index) > threshold) continue;
    background[index] = 1;
    const x = index % width, y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }

  let alpha = new Uint8ClampedArray(total);
  for (let index = 0; index < total; index += 1) alpha[index] = background[index] ? 0 : pixels[index * 4 + 3];
  for (let pass = 0; pass < 2; pass += 1) {
    const softened = new Uint8ClampedArray(total);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0, count = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const nx = x + ox, ny = y + oy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) { sum += alpha[ny * width + nx]; count += 1; }
          }
        }
        softened[y * width + x] = sum / count;
      }
    }
    alpha = softened;
  }

  for (let index = 0; index < total; index += 1) pixels[index * 4 + 3] = alpha[index];
  context.putImageData(imageData, 0, 0);

  const output = document.createElement('canvas');
  output.width = sourceWidth; output.height = sourceHeight;
  const outContext = output.getContext('2d');
  outContext.imageSmoothingEnabled = true;
  outContext.imageSmoothingQuality = 'high';
  outContext.drawImage(work, 0, 0, sourceWidth, sourceHeight);
  return await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
}

async function aiCutout(file, processToken) {
  const module = await import(IMG_LY_ESM);
  const removeBackground = module.removeBackground || module.imglyRemoveBackground || module.default?.removeBackground || module.default;
  if (typeof removeBackground !== 'function') throw new Error('Background removal module unavailable');
  return await removeBackground(file, {
    model: 'isnet_quint8',
    device: 'cpu',
    output: { format: 'image/png', quality: 1, type: 'foreground' },
    progress: (key, current, total) => {
      if (processToken !== state.lastProcessToken) return;
      const percent = total ? Math.round(current / total * 100) : 0;
      dom.processingDetail.textContent = percent > 0 ? `첫 모델 다운로드 ${percent}% · 이후에는 캐시를 사용합니다` : '로컬 모델을 준비하는 중…';
    }
  });
}

function normalizeAccent(color) {
  const hsl = rgbToHsl(color.r, color.g, color.b);
  const adjusted = hslToRgb(hsl.h, clamp(hsl.s, .38, .68), clamp(hsl.l, .34, .48));
  return rgbToHex(adjusted.r, adjusted.g, adjusted.b);
}

function extractTheme(image) {
  const canvas = document.createElement('canvas');
  canvas.width = 144; canvas.height = 144;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0, count: 0 }));
  for (let index = 0; index < data.length; index += 16) {
    const r = data[index], g = data[index + 1], b = data[index + 2], alpha = data[index + 3] / 255;
    if (alpha < .18) continue;
    const hsl = rgbToHsl(r, g, b);
    if (hsl.l < .12 || hsl.l > .9 || hsl.s < .12) continue;
    const bin = bins[Math.floor(hsl.h / 15) % bins.length];
    const weight = alpha * (.35 + hsl.s) * (1 - Math.abs(hsl.l - .5));
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight; bin.count += weight;
  }
  const winner = bins.reduce((best, bin) => bin.weight > best.weight ? bin : best, bins[0]);
  if (!winner.count) return state.theme;
  return normalizeAccent({ r: winner.r / winner.count, g: winner.g / winner.count, b: winner.b / winner.count });
}

function setTheme(hex, isAuto = false) {
  state.theme = hex.toLowerCase();
  state.autoTheme = isAuto;
  dom.customColor.value = state.theme;
  document.documentElement.style.setProperty('--accent', state.theme);
  const firstChip = document.querySelector('.color-chip');
  firstChip.style.setProperty('--chip', state.theme);
  document.querySelectorAll('.color-chip').forEach((chip) => chip.classList.remove('active'));
  firstChip.classList.add('active');
  requestRender();
}

async function processPhoto(file = state.sourceFile) {
  if (!file) return;
  const processToken = ++state.lastProcessToken;
  state.sourceFile = file;
  setProcessing(true, state.mode === 'cutout' ? '식물 윤곽을 만드는 중…' : '원본 사진을 부드럽게 처리하는 중…', '사진 불러오는 중');
  setStatus(`처리 중 · ${file.name}`);
  dom.dropzoneTitle.textContent = file.name;
  dom.dropzoneMeta.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · 클릭하여 사진 변경`;

  try {
    const sourceImage = await fileToImage(file);
    if (processToken !== state.lastProcessToken) return;
    state.sourceImage = sourceImage;

    if (state.mode === 'cutout') {
      let resultBlob;
      let usedFallback = false;
      try {
        dom.processingDetail.textContent = '로컬 AI 배경 제거 모델을 불러오는 중…';
        resultBlob = await aiCutout(file, processToken);
      } catch (error) {
        console.warn('AI cutout unavailable; using local edge fallback.', error);
        usedFallback = true;
        dom.processingDetail.textContent = 'AI 모델을 사용할 수 없어 로컬 윤곽 감지로 전환하는 중…';
        resultBlob = await classicCutout(sourceImage);
      }
      if (processToken !== state.lastProcessToken) return;
      const resultUrl = URL.createObjectURL(resultBlob);
      try { state.processedImage = await loadImage(resultUrl); }
      finally { URL.revokeObjectURL(resultUrl); }
      state.bounds = getCropBounds(state.processedImage);
      setStatus(usedFallback ? '로컬 윤곽 감지 완료 · 세부 조정 후 내보낼 수 있습니다' : 'AI 배경 제거 완료 · 사진은 컴퓨터 밖으로 전송되지 않았습니다');
    } else {
      state.processedImage = sourceImage;
      state.bounds = { x: 0, y: 0, width: sourceImage.naturalWidth, height: sourceImage.naturalHeight };
      setStatus('원본 배경을 유지하고 부드럽게 처리했습니다');
    }

    if (state.autoTheme) setTheme(extractTheme(state.processedImage), true);
    dom.preview.classList.add('hidden');
    dom.canvas.classList.add('visible');
    dom.exportButton.disabled = false;
    renderComposite(dom.canvas, 1280);
  } catch (error) {
    console.error(error);
    setStatus('사진 처리 실패 · 다른 PNG, JPG 또는 WebP 파일로 다시 시도하세요');
  } finally {
    if (processToken === state.lastProcessToken) setProcessing(false);
  }
}

function imageLayout(size) {
  const bounds = state.bounds || { x: 0, y: 0, width: state.processedImage.naturalWidth, height: state.processedImage.naturalHeight };
  const maxWidth = size * .82;
  const maxHeight = size * .82;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  return {
    sx: bounds.x, sy: bounds.y, sw: bounds.width, sh: bounds.height,
    dx: (size - width) / 2, dy: (size - height) / 2 + size * .015,
    dw: width, dh: height
  };
}

function buildMask(size, layout) {
  const maskSize = 220;
  const source = document.createElement('canvas');
  source.width = maskSize; source.height = maskSize;
  const context = source.getContext('2d', { willReadFrequently: true });
  const ratio = maskSize / size;
  context.drawImage(state.processedImage, layout.sx, layout.sy, layout.sw, layout.sh, layout.dx * ratio, layout.dy * ratio, layout.dw * ratio, layout.dh * ratio);
  const core = context.getImageData(0, 0, maskSize, maskSize).data;

  const blur = document.createElement('canvas');
  blur.width = maskSize; blur.height = maskSize;
  const blurContext = blur.getContext('2d', { willReadFrequently: true });
  blurContext.filter = `blur(${8 + state.bloomOverlap * 17}px)`;
  blurContext.globalAlpha = .92;
  blurContext.drawImage(source, 0, 0);
  const halo = blurContext.getImageData(0, 0, maskSize, maskSize).data;
  return { size: maskSize, core, halo };
}

function maskAlpha(mask, x, y, halo = true) {
  const mx = clamp(Math.floor(x * mask.size), 0, mask.size - 1);
  const my = clamp(Math.floor(y * mask.size), 0, mask.size - 1);
  return (halo ? mask.halo : mask.core)[(my * mask.size + mx) * 4 + 3] / 255;
}

function bloomPoints(size, mask) {
  const random = mulberry32(hashState());
  const presetBoost = state.preset === 'pollen' ? 1.28 : state.preset === 'specimen' ? .78 : 1;
  const target = Math.round((800 + state.stippleDensity * 2700) * presetBoost * Math.min(1.25, size / 1280));
  const points = [];
  let attempts = 0;
  while (points.length < target && attempts < target * 18) {
    attempts += 1;
    const x = random(), y = random();
    const halo = maskAlpha(mask, x, y, true);
    const core = maskAlpha(mask, x, y, false);
    const edgeBias = clamp(halo * 1.5 - core * .4, 0, 1);
    const ambient = .012 + state.bloomOverlap * .018;
    if (random() > edgeBias + ambient) continue;
    const baseRadius = state.preset === 'pollen' ? 2.3 : state.preset === 'specimen' ? 1.7 : 3.1;
    const radius = (baseRadius + random() * (state.preset === 'mist' ? 7.2 : 4.6)) * size / 1280;
    points.push({ x: x * size, y: y * size, radius, alpha: .025 + random() * .09, core, foreground: random() < state.bloomOverlap * .23 });
  }
  return points;
}

function drawBloom(context, points, foreground) {
  const secondary = mixColors(state.theme, '#d7d2bd', .32);
  context.save();
  context.globalCompositeOperation = state.preset === 'specimen' ? 'multiply' : 'source-over';
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.foreground !== foreground) continue;
    const color = index % 7 === 0 ? secondary : state.theme;
    const alpha = point.alpha * (foreground ? .7 : 1) * (state.preset === 'mist' ? .72 : 1);
    context.fillStyle = rgba(color, alpha);
    context.beginPath(); context.arc(point.x, point.y, point.radius, 0, Math.PI * 2); context.fill();
  }
  context.restore();
}

function drawPaper(context, size) {
  context.fillStyle = '#f3f1e8';
  context.fillRect(0, 0, size, size);
  const glow = context.createRadialGradient(size * .5, size * .47, size * .06, size * .5, size * .5, size * .7);
  glow.addColorStop(0, 'rgba(255,255,255,.54)');
  glow.addColorStop(.65, 'rgba(255,255,255,.12)');
  glow.addColorStop(1, 'rgba(222,219,204,.12)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
}

function drawPlant(context, size, layout) {
  const presetAlpha = state.preset === 'specimen' ? 1.18 : state.preset === 'mist' ? .9 : 1;
  context.save();
  context.globalAlpha = clamp(state.subjectOpacity * presetAlpha, .08, .82);
  context.globalCompositeOperation = 'multiply';
  context.filter = state.preset === 'mist'
    ? `saturate(.72) contrast(.9) blur(${Math.max(.35, size / 3200)}px)`
    : state.preset === 'specimen' ? 'saturate(.78) contrast(1.06)' : 'saturate(.82) contrast(.96)';
  context.drawImage(state.processedImage, layout.sx, layout.sy, layout.sw, layout.sh, layout.dx, layout.dy, layout.dw, layout.dh);
  context.restore();
}

function pointOnAxis(centerX, centerY, radius, index, ratio = 1) {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  return { x: centerX + Math.cos(angle) * radius * ratio, y: centerY + Math.sin(angle) * radius * ratio };
}

function polygon(context, points) {
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
  context.closePath();
}

function outlinedText(context, text, x, y, fill, font, lineWidth, align = 'center') {
  context.save();
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.font = font;
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(247,246,239,.94)';
  context.lineWidth = lineWidth;
  context.strokeText(text, x, y);
  context.fillStyle = fill;
  context.fillText(text, x, y);
  context.restore();
}

function drawRadar(context, size) {
  const scale = size / 1280;
  const centerX = size * .5, centerY = size * .51, radius = size * .365;
  context.save();
  context.lineJoin = 'round';

  [3 / 7, 5 / 7, 1].forEach((ratio, ringIndex) => {
    const points = traits.map((_, index) => pointOnAxis(centerX, centerY, radius, index, ratio));
    polygon(context, points);
    context.strokeStyle = ringIndex === 2 ? 'rgba(87,89,87,.62)' : 'rgba(87,89,87,.24)';
    context.lineWidth = (ringIndex === 2 ? 3 : 1.15) * scale;
    context.stroke();
  });

  for (let index = 0; index < 6; index += 1) {
    const outer = pointOnAxis(centerX, centerY, radius, index);
    context.beginPath(); context.moveTo(centerX, centerY); context.lineTo(outer.x, outer.y);
    context.strokeStyle = 'rgba(87,89,87,.2)'; context.lineWidth = 1.1 * scale; context.stroke();
  }

  [3, 5, 7].forEach((tick) => {
    const point = pointOnAxis(centerX, centerY, radius, 0, tick / 7);
    outlinedText(context, String(tick), point.x - 14 * scale, point.y, 'rgba(74,76,74,.65)', `500 ${15 * scale}px "Segoe UI"`, 2 * scale);
  });

  const scorePoints = traits.map((trait, index) => pointOnAxis(centerX, centerY, radius, index, clamp(state.scores[trait.key], 1, 7) / 7));
  polygon(context, scorePoints);
  context.fillStyle = rgba(state.theme, .095); context.fill();
  context.strokeStyle = state.theme; context.lineWidth = 5.1 * scale; context.stroke();

  scorePoints.forEach((point, index) => {
    const score = state.scores[traits[index].key];
    context.beginPath(); context.arc(point.x, point.y, 8 * scale, 0, Math.PI * 2);
    context.fillStyle = score < 4 ? '#46688a' : state.theme; context.fill();
    context.strokeStyle = '#f7f5ee'; context.lineWidth = 4 * scale; context.stroke();
  });

  context.beginPath(); context.arc(centerX, centerY, 52 * scale, 0, Math.PI * 2);
  context.fillStyle = '#f7f5ee'; context.fill();
  context.strokeStyle = state.theme; context.lineWidth = 3 * scale; context.stroke();
  context.beginPath(); context.arc(centerX, centerY, 22 * scale, 0, Math.PI * 2);
  context.fillStyle = state.theme; context.fill();

  const labels = [
    { x: .5, y: .072 }, { x: .81, y: .318 }, { x: .82, y: .678 },
    { x: .5, y: .835 }, { x: .18, y: .678 }, { x: .18, y: .318 }
  ];

  traits.forEach((trait, index) => {
    const score = state.scores[trait.key];
    const high = score >= 4;
    const polarityColor = high ? state.theme : '#46688a';
    const label = labels[index];
    const x = size * label.x, y = size * label.y;
    outlinedText(context, score.toFixed(2), x, y, polarityColor, `700 ${45 * scale}px "Segoe UI"`, 7 * scale);
    outlinedText(context, trait.name, x, y + 38 * scale, '#22241f', `700 ${21 * scale}px "Segoe UI"`, 5 * scale);
    outlinedText(context, trait.facet, x, y + 63 * scale, '#565951', `italic ${18 * scale}px "Segoe UI"`, 4 * scale);
    outlinedText(context, `${high ? '△' : '▽'} ${high ? trait.high : trait.low}`, x, y + 87 * scale, polarityColor, `700 ${20 * scale}px "Segoe UI"`, 5 * scale);
  });
  context.restore();
}

function renderComposite(targetCanvas, size = 1280) {
  if (!state.processedImage) return;
  targetCanvas.width = size;
  targetCanvas.height = size;
  const context = targetCanvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawPaper(context, size);
  const layout = imageLayout(size);
  const mask = buildMask(size, layout);
  const points = bloomPoints(size, mask);
  drawBloom(context, points, false);
  drawPlant(context, size, layout);
  drawBloom(context, points, true);
  drawRadar(context, size);
}

function requestRender() {
  if (!state.processedImage || state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => { state.renderQueued = false; renderComposite(dom.canvas, 1280); });
}

function bindRange(id, stateKey) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${id}Value`);
  input.addEventListener('input', () => {
    output.value = `${input.value}%`;
    state[stateKey] = Number(input.value) / 100;
    requestRender();
  });
}

bindRange('subjectOpacity', 'subjectOpacity');
bindRange('bloomOverlap', 'bloomOverlap');
bindRange('stippleDensity', 'stippleDensity');

document.querySelectorAll('[data-score]').forEach((input) => {
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) state.scores[input.dataset.score] = clamp(value, 1, 7);
    requestRender();
  });
  input.addEventListener('blur', () => { input.value = clamp(Number(input.value) || 4, 1, 7).toFixed(2); });
});

document.querySelectorAll('.segment').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.classList.contains('active')) return;
    document.querySelectorAll('.segment').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.mode = button.dataset.mode;
    const cutout = state.mode === 'cutout';
    dom.cutoutHint.textContent = cutout
      ? '처음 사용할 때 로컬 배경 제거 모델을 다운로드합니다. 사진은 업로드되지 않습니다.'
      : '사진 배경을 유지한 채 전체 사진에 부드러운 저투명도 효과를 적용합니다.';
    if (state.sourceFile) await processPhoto();
    else setStatus(cutout ? 'AI 자동 배경 제거 모드 · 사진 업로드 대기 중' : '원본 유지 모드 · 사진 업로드 대기 중');
  });
});

const presets = {
  mist: { opacity: 36, overlap: 68, density: 58 },
  pollen: { opacity: 31, overlap: 76, density: 78 },
  specimen: { opacity: 48, overlap: 51, density: 42 }
};

document.querySelectorAll('.preset').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.preset = button.dataset.preset;
    const preset = presets[state.preset];
    [['subjectOpacity', 'subjectOpacity', preset.opacity], ['bloomOverlap', 'bloomOverlap', preset.overlap], ['stippleDensity', 'stippleDensity', preset.density]].forEach(([id, key, value]) => {
      document.querySelector(`#${id}`).value = value;
      document.querySelector(`#${id}Value`).value = `${value}%`;
      state[key] = value / 100;
    });
    setStatus(`${button.querySelector('b').textContent} 프리셋 · 다시 렌더링했습니다`);
    requestRender();
  });
});

document.querySelectorAll('.color-chip').forEach((button) => {
  button.addEventListener('click', () => setTheme(button.style.getPropertyValue('--chip').trim(), false));
});

document.querySelector('#eyedropperButton').addEventListener('click', () => dom.customColor.click());
dom.customColor.addEventListener('input', () => setTheme(dom.customColor.value, false));

async function loadPhoto(file) {
  if (!file || !file.type.startsWith('image/')) { setStatus('PNG, JPG 또는 WebP 이미지를 선택하세요'); return; }
  await processPhoto(file);
}

dom.photoInput.addEventListener('change', () => loadPhoto(dom.photoInput.files[0]));
['dragenter', 'dragover'].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
  event.preventDefault(); dom.dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
  event.preventDefault(); dom.dropzone.classList.remove('dragging');
}));
dom.dropzone.addEventListener('drop', (event) => loadPhoto(event.dataTransfer.files[0]));

document.querySelector('#resetButton').addEventListener('click', () => {
  document.querySelectorAll('[data-score]').forEach((input) => {
    input.value = Number(defaults[input.dataset.score]).toFixed(2);
    state.scores[input.dataset.score] = defaults[input.dataset.score];
  });
  [['subjectOpacity', 'subjectOpacity'], ['bloomOverlap', 'bloomOverlap'], ['stippleDensity', 'stippleDensity']].forEach(([id, key]) => {
    document.querySelector(`#${id}`).value = defaults[id];
    document.querySelector(`#${id}Value`).value = `${defaults[id]}%`;
    state[key] = defaults[id] / 100;
  });
  state.preset = 'mist';
  document.querySelectorAll('.preset').forEach((item) => item.classList.toggle('active', item.dataset.preset === 'mist'));
  if (state.sourceImage) {
    setTheme(extractTheme(state.processedImage || state.sourceImage), true);
    requestRender(); setStatus('설정을 기본값으로 복원했습니다');
  } else {
    setTheme('#6651a3', true); setStatus('참고 스타일 미리보기 · 사진 업로드 대기 중');
  }
});

dom.exportButton.addEventListener('click', async () => {
  if (!state.processedImage || state.processing) return;
  setStatus('2048 × 2048 고해상도 PNG를 생성하는 중…');
  dom.exportButton.disabled = true;
  await new Promise((resolve) => setTimeout(resolve, 40));
  const exportCanvas = document.createElement('canvas');
  renderComposite(exportCanvas, 2048);
  exportCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.download = `plantality-profile-${stamp}.png`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('고해상도 PNG 내보내기 완료');
    dom.exportButton.disabled = false;
  }, 'image/png');
});

document.querySelectorAll('.icon-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.icon-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    const fullSize = button.textContent.trim() === '100%';
    document.querySelector('#artboard').style.width = fullSize ? 'min(760px, calc(100vh - 196px))' : '';
  });
});

