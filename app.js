const IMG_LY_ESM = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';

// 내보내기 한 변 길이. 여백이 생긴 만큼 키워 그림 자체의 해상도를 유지한다.
const EXPORT_SIZE = 2560;

const defaults = {
  h: 6.42, e: 3.38, x: 5.41, a: 5.79, c: 5.74, o: 5.36,
  outerScale: 82, originalOpacity: 35, stippleDensity: 58, bloomSpread: 68, bloomSoftness: 45,
  innerOpacity: 45, innerScale: 50, innerFilterAmount: 60,
  radarScale: 100, radarWidth: 100, radarFill: 10,
  canvasMargin: 10
};

// 퍼센트 단위 슬라이더 id ↔ state 키 (모두 state에는 /100 값으로 저장)
const sliderKeys = ['outerScale', 'originalOpacity', 'stippleDensity', 'bloomSpread', 'bloomSoftness', 'innerOpacity', 'innerScale', 'innerFilterAmount', 'radarScale', 'radarWidth', 'radarFill', 'canvasMargin'];

const traits = [
  { key: 'h', name: 'Honesty–Humility', subscale: 'Fairness/Sincerity', high: 'sincere', low: 'deceitful' },
  { key: 'e', name: 'Emotionality', subscale: 'Dependence', high: 'dependent', low: 'independent' },
  { key: 'x', name: 'eXtraversion', subscale: 'Social Boldness', high: 'proactive', low: 'reserved' },
  { key: 'a', name: 'Agreeableness', subscale: 'Flexibility', high: 'accommodating', low: 'stubborn' },
  { key: 'c', name: 'Conscientiousness', subscale: 'Organization', high: 'organized', low: 'disorganized' },
  { key: 'o', name: 'Openness to Experience', subscale: 'Creativity', high: 'imaginative', low: 'conventional' }
];

const defaultSubscales = () => Object.fromEntries(traits.map((trait) => [trait.key, { name: trait.subscale, high: trait.high, low: trait.low }]));

const emptySlot = () => ({ file: null, sourceImage: null, image: null, bounds: null, token: 0 });

const state = {
  photos: { outer: emptySlot(), inner: emptySlot() },
  mode: 'cutout',
  outerRotation: 0,
  innerRotation: 0,
  innerMonotone: false,
  innerMonoColor: null, // null이면 테마 색상을 따른다
  innerFilter: 'none',  // none | stipple | grain
  radarNumberColor: null, // null이면 테마 색상을 따른다
  subscales: defaultSubscales(),
  theme: '#6651a3',
  autoTheme: true,
  ...Object.fromEntries(sliderKeys.map((key) => [key, defaults[key] / 100])),
  scores: { h: defaults.h, e: defaults.e, x: defaults.x, a: defaults.a, c: defaults.c, o: defaults.o },
  processing: new Set(),
  renderQueued: false
};

const outerSlot = () => state.photos.outer.image ? state.photos.outer : state.photos.inner;
const innerSlot = () => state.photos.inner.image ? state.photos.inner : state.photos.outer;
const hasImage = () => Boolean(state.photos.outer.image || state.photos.inner.image);

const dom = {
  dropzones: {
    outer: {
      zone: document.querySelector('#dropzoneOuter'),
      title: document.querySelector('#dropzoneOuterTitle'),
      meta: document.querySelector('#dropzoneOuterMeta'),
      input: document.querySelector('#photoInputOuter')
    },
    inner: {
      zone: document.querySelector('#dropzoneInner'),
      title: document.querySelector('#dropzoneInnerTitle'),
      meta: document.querySelector('#dropzoneInnerMeta'),
      input: document.querySelector('#photoInputInner')
    }
  },
  canvas: document.querySelector('#renderCanvas'),
  overlay: document.querySelector('#processingOverlay'),
  processingTitle: document.querySelector('#processingTitle'),
  processingDetail: document.querySelector('#processingDetail'),
  stageStatus: document.querySelector('#stageStatus'),
  exportButton: document.querySelector('#exportButton'),
  cutoutHint: document.querySelector('#cutoutHint'),
  customColor: document.querySelector('#customColor')
};

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

function setProcessing(slotName, visible, title = '', detail = '') {
  if (visible) state.processing.add(slotName);
  else state.processing.delete(slotName);
  const busy = state.processing.size > 0;
  dom.overlay.classList.toggle('visible', busy);
  if (title) dom.processingTitle.textContent = title;
  if (detail) dom.processingDetail.textContent = detail;
  dom.exportButton.disabled = busy;
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

async function aiCutout(file, slot, token) {
  const module = await import(IMG_LY_ESM);
  const removeBackground = module.removeBackground || module.imglyRemoveBackground || module.default?.removeBackground || module.default;
  if (typeof removeBackground !== 'function') throw new Error('Background removal module unavailable');
  return await removeBackground(file, {
    model: 'isnet_quint8',
    device: 'cpu',
    output: { format: 'image/png', quality: 1, type: 'foreground' },
    progress: (key, current, total) => {
      if (token !== slot.token) return;
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

async function processPhoto(slotName, file = null) {
  const slot = state.photos[slotName];
  if (!file) file = slot.file;
  if (!file) return;
  const token = ++slot.token;
  slot.file = file;
  const zone = dom.dropzones[slotName];
  setProcessing(slotName, true, state.mode === 'cutout' ? '식물 윤곽을 만드는 중…' : '원본 사진을 부드럽게 처리하는 중…', '사진 불러오는 중');
  setStatus(`처리 중 · ${file.name}`);
  zone.title.textContent = file.name;
  zone.meta.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB · 클릭하여 사진 변경`;

  try {
    const sourceImage = await fileToImage(file);
    if (token !== slot.token) return;
    slot.sourceImage = sourceImage;

    if (state.mode === 'cutout') {
      let resultBlob;
      let usedFallback = false;
      try {
        dom.processingDetail.textContent = '로컬 AI 배경 제거 모델을 불러오는 중…';
        resultBlob = await aiCutout(file, slot, token);
      } catch (error) {
        console.warn('AI cutout unavailable; using local edge fallback.', error);
        usedFallback = true;
        dom.processingDetail.textContent = 'AI 모델을 사용할 수 없어 로컬 윤곽 감지로 전환하는 중…';
        resultBlob = await classicCutout(sourceImage);
      }
      if (token !== slot.token) return;
      const resultUrl = URL.createObjectURL(resultBlob);
      try { slot.image = await loadImage(resultUrl); }
      finally { URL.revokeObjectURL(resultUrl); }
      slot.bounds = getCropBounds(slot.image);
      setStatus(usedFallback ? '로컬 윤곽 감지 완료 · 세부 조정 후 내보낼 수 있습니다' : 'AI 배경 제거 완료 · 사진은 컴퓨터 밖으로 전송되지 않았습니다');
    } else {
      slot.image = sourceImage;
      slot.bounds = { x: 0, y: 0, width: sourceImage.naturalWidth, height: sourceImage.naturalHeight };
      setStatus('원본 배경을 유지하고 부드럽게 처리했습니다');
    }

    if (state.autoTheme) setTheme(extractTheme(outerSlot().image), true);
    renderComposite(dom.canvas, 1280);
  } catch (error) {
    console.error(error);
    setStatus('사진 처리 실패 · 다른 PNG, JPG 또는 WebP 파일로 다시 시도하세요');
  } finally {
    if (token === slot.token) setProcessing(slotName, false);
  }
}

function imageLayout(size, slot, fraction = .82) {
  const bounds = slot.bounds || { x: 0, y: 0, width: slot.image.naturalWidth, height: slot.image.naturalHeight };
  const maxWidth = size * fraction;
  const maxHeight = size * fraction;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  return {
    sx: bounds.x, sy: bounds.y, sw: bounds.width, sh: bounds.height,
    dx: (size - width) / 2, dy: (size - height) / 2 + size * .015,
    dw: width, dh: height
  };
}

function buildMask(size, layout, image) {
  const maskSize = 300;
  const source = document.createElement('canvas');
  source.width = maskSize; source.height = maskSize;
  const context = source.getContext('2d', { willReadFrequently: true });
  const ratio = maskSize / size;
  context.save();
  context.translate((layout.dx + layout.dw / 2) * ratio, (layout.dy + layout.dh / 2) * ratio);
  context.rotate(state.outerRotation * Math.PI / 180);
  context.drawImage(image, layout.sx, layout.sy, layout.sw, layout.sh, -layout.dw / 2 * ratio, -layout.dh / 2 * ratio, layout.dw * ratio, layout.dh * ratio);
  context.restore();
  const imageData = context.getImageData(0, 0, maskSize, maskSize);
  const core = imageData.data;

  // 이미지에 투명 정보가 사실상 없으면(흰 배경 선화·로고, 원본 유지 모드의 JPG 등)
  // 밝기를 실루엣으로 사용한다 — 어두운 선·면이 모양이 되고 흰 배경은 비워진다
  let opaqueCount = 0, filledCount = 0;
  for (let i = 3; i < core.length; i += 4) {
    if (core[i] > 8) filledCount += 1;
    if (core[i] > 250) opaqueCount += 1;
  }
  if (filledCount > 0 && opaqueCount / filledCount > .97) {
    for (let i = 0; i < core.length; i += 4) {
      if (core[i + 3] < 8) continue; // 레이아웃 바깥 여백은 그대로 둔다
      const lum = (core[i] * .299 + core[i + 1] * .587 + core[i + 2] * .114) / 255;
      core[i + 3] = Math.round(clamp((1 - lum) * 1.7 - .08, 0, 1) * 255);
    }
  }

  // 닫힌 안쪽 영역 채우기: 마스크 테두리에서 빈 픽셀로 도달할 수 없는 영역은
  // 실루엣 내부로 간주한다 — 윤곽선만 있는 이미지도 안쪽에는 점이 생기지 않는다
  {
    const total = maskSize * maskSize;
    const outside = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0, tail = 0;
    const push = (index) => {
      if (!outside[index] && core[index * 4 + 3] < 40) { outside[index] = 1; queue[tail++] = index; }
    };
    for (let x = 0; x < maskSize; x += 1) { push(x); push((maskSize - 1) * maskSize + x); }
    for (let y = 1; y < maskSize - 1; y += 1) { push(y * maskSize); push(y * maskSize + maskSize - 1); }
    while (head < tail) {
      const index = queue[head++];
      const x = index % maskSize, y = Math.floor(index / maskSize);
      if (x > 0) push(index - 1);
      if (x < maskSize - 1) push(index + 1);
      if (y > 0) push(index - maskSize);
      if (y < maskSize - 1) push(index + maskSize);
    }
    for (let index = 0; index < total; index += 1) {
      if (!outside[index] && core[index * 4 + 3] < 200) core[index * 4 + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);

  const blur = document.createElement('canvas');
  blur.width = maskSize; blur.height = maskSize;
  const blurContext = blur.getContext('2d', { willReadFrequently: true });
  // 번짐 반경은 마스크 크기가 아니라 실루엣 크기에 비례시킨다 —
  // 마스크 해상도나 무대 크기를 바꿔도 번짐 모양이 그대로 유지된다
  const shapeOnMask = Math.max(layout.dw, layout.dh) * (maskSize / size);
  blurContext.filter = `blur(${(.03 + state.bloomSpread * .107) * shapeOnMask}px)`;
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
  const target = Math.round((1200 + state.stippleDensity * 10000) * Math.min(1.25, size / 1280));
  const points = [];
  let attempts = 0;
  while (points.length < target && attempts < target * 60) {
    attempts += 1;
    const x = random(), y = random();
    const halo = maskAlpha(mask, x, y, true);
    const core = maskAlpha(mask, x, y, false);
    // 실루엣 경계 바로 바깥(halo는 있는데 core는 없는 띠)에서만 확률이 높다 —
    // 깊은 안쪽/먼 바깥은 0에 수렴해 점이 가장자리를 따라 몰린다
    const fringe = clamp(halo - core * .92, 0, 1);
    const edgeBias = Math.pow(fringe, .75) * 1.4;
    const ambient = .001; // 실루엣 안쪽·먼 배경에는 점을 거의 뿌리지 않는다
    if (random() > edgeBias + ambient) continue;
    // 번짐: 낮으면 작고 또렷한 점, 높으면 크고 옅은 점
    const soft = state.bloomSoftness;
    const radius = (1.4 + random() * 2.4) * (.6 + soft * 2.8) * size / 1280;
    const alpha = (.06 + random() * .12) * (1.25 - soft * .55);
    points.push({ x: x * size, y: y * size, radius, alpha, core, foreground: random() < .18 });
  }
  return points;
}

function drawBloom(context, points, foreground) {
  const secondary = mixColors(state.theme, '#d7d2bd', .32);
  context.save();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.foreground !== foreground) continue;
    const color = index % 7 === 0 ? secondary : state.theme;
    const alpha = point.alpha * (foreground ? .7 : 1);
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

function plantSourceCanvas(image, layout) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.dw));
  canvas.height = Math.max(1, Math.round(layout.dh));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, layout.sx, layout.sy, layout.sw, layout.sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// 명암은 유지하고 색만 지정색으로 바꾼다. 'color' 합성은 알파를 채우므로 원본 알파로 다시 잘라낸다.
function applyMonotone(canvas, image, layout, hex) {
  const context = canvas.getContext('2d');
  context.globalCompositeOperation = 'color';
  context.fillStyle = hex;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(image, layout.sx, layout.sy, layout.sw, layout.sh, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
}

// 거친 입자: 명암에 잡음을 섞고 일부 픽셀을 흩뜨려 사진이 알갱이로 부서지게 한다
function applyGrain(canvas, amount, random) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const strength = amount * 160;
  const speckle = amount * .5;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 6) continue;
    const noise = (random() - .5) * strength;
    pixels[index] = clamp(pixels[index] + noise, 0, 255);
    pixels[index + 1] = clamp(pixels[index + 1] + noise, 0, 255);
    pixels[index + 2] = clamp(pixels[index + 2] + noise, 0, 255);
    if (random() < speckle) pixels[index + 3] = Math.round(pixels[index + 3] * random() * .85);
  }
  context.putImageData(imageData, 0, 0);
}

// 점묘: 사진을 바깥 번짐과 같은 점 어휘(같은 반지름 범위)로 다시 그려 질감을 맞춘다.
// context는 이미 레이아웃 중심으로 이동·회전된 상태로 들어온다.
function drawPlantStipple(context, size, layout, image, random, amount, monoHex) {
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(layout.dw, layout.dh));
  const width = Math.max(1, Math.round(layout.dw * scale));
  const height = Math.max(1, Math.round(layout.dh * scale));
  const sampler = document.createElement('canvas');
  sampler.width = width; sampler.height = height;
  const samplerContext = sampler.getContext('2d', { willReadFrequently: true });
  samplerContext.drawImage(image, layout.sx, layout.sy, layout.sw, layout.sh, 0, 0, width, height);
  const pixels = samplerContext.getImageData(0, 0, width, height).data;

  const area = (layout.dw * layout.dh) / (size * size);
  const target = Math.round(area * 90000 * amount * Math.min(1.25, size / 1280));
  const radiusUnit = (.6 + state.bloomSoftness * 2.8) * size / 1280;
  let placed = 0, attempts = 0;
  while (placed < target && attempts < target * 25) {
    attempts += 1;
    const u = random(), v = random();
    const offset = (Math.floor(v * height) * width + Math.floor(u * width)) * 4;
    const alpha = pixels[offset + 3] / 255;
    if (alpha < .05) continue;
    const lum = (pixels[offset] * .299 + pixels[offset + 1] * .587 + pixels[offset + 2] * .114) / 255;
    if (random() > alpha * (.3 + .7 * (1 - lum))) continue;
    placed += 1;
    const radius = (1.4 + random() * 2.4) * radiusUnit;
    const color = monoHex || rgbToHex(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    context.fillStyle = rgba(color, .16 + random() * .3);
    context.beginPath();
    context.arc(-layout.dw / 2 + u * layout.dw, -layout.dh / 2 + v * layout.dh, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawPlant(context, size, layout, image, opacity, options = {}) {
  const { rotate = 0, monotone = false, monoColor = null, filter = 'none', filterAmount = .6 } = options;
  const monoHex = monotone ? (monoColor || state.theme) : null;
  const random = mulberry32(hashState() ^ 0x5bf03635);

  context.save();
  context.globalAlpha = clamp(opacity, .02, .85);
  context.translate(layout.dx + layout.dw / 2, layout.dy + layout.dh / 2);
  if (rotate) context.rotate(rotate * Math.PI / 180);

  if (filter === 'stipple') {
    drawPlantStipple(context, size, layout, image, random, filterAmount, monoHex);
    context.restore();
    return;
  }

  context.globalCompositeOperation = 'multiply';
  context.filter = 'saturate(.82) contrast(.96)';
  let source = image, sx = layout.sx, sy = layout.sy, sw = layout.sw, sh = layout.sh;
  if (monoHex || filter === 'grain') {
    const prepared = plantSourceCanvas(image, layout);
    if (monoHex) applyMonotone(prepared, image, layout, monoHex);
    if (filter === 'grain') applyGrain(prepared, filterAmount, random);
    source = prepared; sx = 0; sy = 0; sw = prepared.width; sh = prepared.height;
  }
  context.drawImage(source, sx, sy, sw, sh, -layout.dw / 2, -layout.dh / 2, layout.dw, layout.dh);
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
  const centerX = size * .5, centerY = size * .51, radius = size * .365 * state.radarScale;
  context.save();
  context.lineJoin = 'round';

  // 원형 그리드: 1~7점에 대응하는 동심원 + 바깥 여운 원
  for (let step = 1; step <= 7; step += 1) {
    context.beginPath();
    context.arc(centerX, centerY, radius * step / 7, 0, Math.PI * 2);
    context.strokeStyle = rgba(state.theme, step === 7 ? .2 : .11);
    context.lineWidth = 1.2 * scale;
    context.stroke();
  }
  context.beginPath();
  context.arc(centerX, centerY, radius * 1.13, 0, Math.PI * 2);
  context.strokeStyle = rgba(state.theme, .16);
  context.lineWidth = 1.2 * scale;
  context.stroke();

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
  context.fillStyle = rgba(state.theme, state.radarFill); context.fill();
  context.strokeStyle = state.theme; context.lineWidth = 5.1 * scale * state.radarWidth; context.stroke();

  scorePoints.forEach((point, index) => {
    const score = state.scores[traits[index].key];
    context.beginPath(); context.arc(point.x, point.y, 8 * scale * (.7 + .3 * state.radarWidth), 0, Math.PI * 2);
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
    const numberColor = state.radarNumberColor || polarityColor;
    const label = labels[index];
    // 그래프 크기에 맞춰 라벨도 중심 기준으로 같이 이동
    const x = size * (.5 + (label.x - .5) * state.radarScale);
    const y = size * (.51 + (label.y - .51) * state.radarScale);
    outlinedText(context, score.toFixed(2), x, y, numberColor, `700 ${45 * scale}px "Segoe UI"`, 7 * scale);
    outlinedText(context, trait.name, x, y + 38 * scale, '#22241f', `700 ${21 * scale}px "Segoe UI"`, 5 * scale);
    // 서브스케일 한 줄 표기: "Dependence: low(independent)" — 전체를 같은 스타일로
    const sub = state.subscales[trait.key];
    const subLine = `${sub.name}: ${high ? 'high' : 'low'}(${high ? sub.high : sub.low})`;
    outlinedText(context, subLine, x, y + 64 * scale, '#565951', `600 ${19 * scale}px "Segoe UI"`, 4 * scale);
  });
  context.restore();
}

function renderComposite(targetCanvas, size = 1280) {
  targetCanvas.width = size;
  targetCanvas.height = size;
  const context = targetCanvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  drawPaper(context, size);

  // 여백: 사진과 그래프는 안쪽 구도(inner)에 맞춰 배치하고,
  // **번짐 점은 캔버스 전체를 무대로 삼는다** — 점이 여백까지 자연스럽게 흩어져
  // 정사각형으로 잘린 경계가 생기지 않는다.
  const margin = clamp(state.canvasMargin, 0, .25);
  const inner = size * (1 - margin * 2);
  const offset = size * margin;
  // 안쪽 구도 기준 레이아웃을 캔버스 좌표로 옮긴다
  const placed = (slot, fraction) => {
    const layout = imageLayout(inner, slot, fraction);
    return { ...layout, dx: layout.dx + offset, dy: layout.dy + offset };
  };

  if (hasImage()) {
    const maskSlot = outerSlot();
    const plantSlot = innerSlot();
    const maskLayout = placed(maskSlot, state.outerScale);
    const mask = buildMask(size, maskLayout, maskSlot.image);
    const points = bloomPoints(size, mask);
    drawBloom(context, points, false);
    // 원본(바깥) 이미지는 실루엣과 같은 위치·크기·회전으로 그려 점과 정렬된다. 투명도 0이면 숨김.
    if (state.originalOpacity > 0) {
      drawPlant(context, size, maskLayout, maskSlot.image, state.originalOpacity, { rotate: state.outerRotation });
    }
    // 안쪽 사진은 별도로 올렸을 때만 중앙에 그린다.
    if (plantSlot.image && plantSlot !== maskSlot && state.innerOpacity > 0) {
      drawPlant(context, size, placed(plantSlot, state.innerScale), plantSlot.image, state.innerOpacity, {
        rotate: state.innerRotation,
        monotone: state.innerMonotone,
        monoColor: state.innerMonoColor,
        filter: state.innerFilter,
        filterAmount: state.innerFilterAmount
      });
    }
    drawBloom(context, points, true);
  }

  context.save();
  context.translate(offset, offset);
  drawRadar(context, inner);
  context.restore();
}

function requestRender() {
  if (state.renderQueued) return;
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

sliderKeys.forEach((key) => bindRange(key, key));

const bindRotation = (id, stateKey) => {
  const input = document.querySelector(`#${id}`);
  input.addEventListener('input', () => {
    document.querySelector(`#${id}Value`).value = `${input.value}°`;
    state[stateKey] = Number(input.value);
    requestRender();
  });
};
bindRotation('outerRotation', 'outerRotation');
bindRotation('innerRotation', 'innerRotation');

document.querySelectorAll('[data-sub]').forEach((input) => {
  input.addEventListener('input', () => {
    state.subscales[input.dataset.sub][input.dataset.field] = input.value.trim();
    requestRender();
  });
});

const radarNumberInput = document.querySelector('#radarNumberColor');
document.querySelectorAll('.segment[data-numcolor]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.segment[data-numcolor]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.numcolor === 'theme') {
      state.radarNumberColor = null;
      requestRender();
    } else {
      state.radarNumberColor = radarNumberInput.value;
      requestRender();
      radarNumberInput.click();
    }
  });
});
radarNumberInput.addEventListener('input', () => {
  state.radarNumberColor = radarNumberInput.value;
  document.querySelectorAll('.segment[data-numcolor]').forEach((item) => item.classList.toggle('active', item.dataset.numcolor === 'custom'));
  requestRender();
});

document.querySelectorAll('.segment[data-tone]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.classList.contains('active')) return;
    document.querySelectorAll('.segment[data-tone]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.innerMonotone = button.dataset.tone === 'mono';
    requestRender();
  });
});

const innerMonoInput = document.querySelector('#innerMonoColor');
document.querySelectorAll('.segment[data-monocolor]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.segment[data-monocolor]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    if (button.dataset.monocolor === 'theme') {
      state.innerMonoColor = null;
      requestRender();
    } else {
      state.innerMonoColor = innerMonoInput.value;
      requestRender();
      innerMonoInput.click();
    }
  });
});
innerMonoInput.addEventListener('input', () => {
  state.innerMonoColor = innerMonoInput.value;
  document.querySelectorAll('.segment[data-monocolor]').forEach((item) => item.classList.toggle('active', item.dataset.monocolor === 'custom'));
  requestRender();
});

document.querySelectorAll('.segment[data-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.classList.contains('active')) return;
    document.querySelectorAll('.segment[data-filter]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.innerFilter = button.dataset.filter;
    requestRender();
  });
});

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === button));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === button.dataset.tab));
  });
});

document.querySelectorAll('[data-score]').forEach((input) => {
  input.addEventListener('input', () => {
    const value = Number(input.value);
    if (Number.isFinite(value)) state.scores[input.dataset.score] = clamp(value, 1, 7);
    requestRender();
  });
  input.addEventListener('blur', () => { input.value = clamp(Number(input.value) || 4, 1, 7).toFixed(2); });
});

document.querySelectorAll('.segment[data-mode]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (button.classList.contains('active')) return;
    document.querySelectorAll('.segment[data-mode]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.mode = button.dataset.mode;
    const cutout = state.mode === 'cutout';
    dom.cutoutHint.textContent = cutout
      ? '처음 사용할 때 로컬 배경 제거 모델을 다운로드합니다. 사진은 업로드되지 않습니다.'
      : '사진 배경을 유지한 채 전체 사진에 부드러운 저투명도 효과를 적용합니다.';
    if (!state.photos.outer.file && !state.photos.inner.file) {
      setStatus(cutout ? 'AI 자동 배경 제거 모드 · 사진 업로드 대기 중' : '원본 유지 모드 · 사진 업로드 대기 중');
      return;
    }
    if (state.photos.outer.file) await processPhoto('outer');
    if (state.photos.inner.file) await processPhoto('inner');
  });
});

document.querySelectorAll('.color-chip').forEach((button) => {
  button.addEventListener('click', () => setTheme(button.style.getPropertyValue('--chip').trim(), false));
});

document.querySelector('#eyedropperButton').addEventListener('click', () => dom.customColor.click());
dom.customColor.addEventListener('input', () => setTheme(dom.customColor.value, false));

async function loadPhoto(slotName, file) {
  if (!file || !file.type.startsWith('image/')) { setStatus('PNG, JPG 또는 WebP 이미지를 선택하세요'); return; }
  await processPhoto(slotName, file);
}

Object.entries(dom.dropzones).forEach(([slotName, zone]) => {
  zone.input.addEventListener('change', () => loadPhoto(slotName, zone.input.files[0]));
  ['dragenter', 'dragover'].forEach((eventName) => zone.zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.zone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => zone.zone.addEventListener(eventName, (event) => {
    event.preventDefault(); zone.zone.classList.remove('dragging');
  }));
  zone.zone.addEventListener('drop', (event) => loadPhoto(slotName, event.dataTransfer.files[0]));
});

// 완전 초기화: 사진·설정·미리보기를 앱 첫 화면 상태로 되돌린다
document.querySelector('#resetButton').addEventListener('click', () => {
  // 진행 중인 사진 처리가 끝나도 결과를 버리도록 토큰을 올리고 슬롯을 비운다
  state.photos.outer.token += 1;
  state.photos.inner.token += 1;
  state.photos = { outer: emptySlot(), inner: emptySlot() };
  state.processing.clear();
  dom.overlay.classList.remove('visible');

  const dropzoneText = {
    outer: ['바깥 꽃 사진 (번짐·점묘 모양)', '끌어다 놓거나 클릭하여 PNG, JPG, WebP 선택'],
    inner: ['안쪽 꽃 사진 (중앙)', '비워두면 바깥 꽃 사진을 함께 사용']
  };
  Object.entries(dom.dropzones).forEach(([slotName, zone]) => {
    zone.input.value = '';
    zone.title.textContent = dropzoneText[slotName][0];
    zone.meta.textContent = dropzoneText[slotName][1];
  });

  document.querySelectorAll('[data-score]').forEach((input) => {
    input.value = Number(defaults[input.dataset.score]).toFixed(2);
    state.scores[input.dataset.score] = defaults[input.dataset.score];
  });
  sliderKeys.forEach((id) => {
    document.querySelector(`#${id}`).value = defaults[id];
    document.querySelector(`#${id}Value`).value = `${defaults[id]}%`;
    state[id] = defaults[id] / 100;
  });

  state.mode = 'cutout';
  document.querySelectorAll('.segment[data-mode]').forEach((item) => item.classList.toggle('active', item.dataset.mode === 'cutout'));
  ['outerRotation', 'innerRotation'].forEach((id) => {
    state[id] = 0;
    document.querySelector(`#${id}`).value = 0;
    document.querySelector(`#${id}Value`).value = '0°';
  });
  state.innerMonotone = false;
  document.querySelectorAll('.segment[data-tone]').forEach((item) => item.classList.toggle('active', item.dataset.tone === 'color'));
  state.innerMonoColor = null;
  document.querySelectorAll('.segment[data-monocolor]').forEach((item) => item.classList.toggle('active', item.dataset.monocolor === 'theme'));
  state.innerFilter = 'none';
  document.querySelectorAll('.segment[data-filter]').forEach((item) => item.classList.toggle('active', item.dataset.filter === 'none'));
  state.radarNumberColor = null;
  document.querySelectorAll('.segment[data-numcolor]').forEach((item) => item.classList.toggle('active', item.dataset.numcolor === 'theme'));
  state.subscales = defaultSubscales();
  document.querySelectorAll('[data-sub]').forEach((input) => {
    input.value = state.subscales[input.dataset.sub][input.dataset.field];
  });
  dom.cutoutHint.textContent = '처음 사용할 때 로컬 배경 제거 모델을 다운로드합니다. 사진은 업로드되지 않습니다.';

  document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === 'outer'));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.tabPanel === 'outer'));

  dom.exportButton.disabled = false;
  setTheme('#6651a3', true);
  renderComposite(dom.canvas, 1280);
  setStatus('초기화 완료 · 기본 그래프 · 사진 업로드 대기 중');
});

dom.exportButton.addEventListener('click', async () => {
  if (state.processing.size > 0) return;
  setStatus(`${EXPORT_SIZE} × ${EXPORT_SIZE} 고해상도 PNG를 생성하는 중…`);
  dom.exportButton.disabled = true;
  await new Promise((resolve) => setTimeout(resolve, 40));
  const exportCanvas = document.createElement('canvas');
  renderComposite(exportCanvas, EXPORT_SIZE);
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

// 사진이 없어도 그리드와 HEXACO 육각형은 기본 이미지로 그려 둔다
dom.canvas.classList.add('visible');
renderComposite(dom.canvas, 1280);

