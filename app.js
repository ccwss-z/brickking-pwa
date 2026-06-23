const ROWS = 14;
const COLS = 10;
const CELL_COUNT = ROWS * COLS;
const DEFAULT_THRESHOLD = 0.235;

const state = {
  image: null,
  sourceDataURL: "",
  grid: null,
  board: Array(CELL_COUNT).fill(0),
  confidence: Array(CELL_COUNT).fill(0),
  atlas: [],
  steps: [],
  stepIndex: 0,
  stepBoards: [],
  autoTimer: null,
  canvasMode: "screenshot"
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const els = {
  imageInput: $("#imageInput"),
  atlasInput: $("#atlasInput"),
  previewCanvas: $("#previewCanvas"),
  sourceImage: $("#sourceImage"),
  emptyPreview: $("#emptyPreview"),
  emptyCutPreview: $("#emptyCutPreview"),
  correctionBoard: $("#correctionBoard"),
  stepBoard: $("#stepBoard"),
  statusText: $("#statusText"),
  warningMessage: $("#warningMessage"),
  recognizeButton: $("#recognizeButton"),
  solveButton: $("#solveButton"),
  uploadButtonText: $("#uploadButtonText"),
  savePreviewButton: $("#savePreviewButton"),
  stepTitle: $("#stepTitle"),
  stepDescription: $("#stepDescription"),
  stepCounter: $("#stepCounter"),
  resultTitle: $("#resultTitle"),
  resultSubtitle: $("#resultSubtitle"),
  resultReason: $("#resultReason"),
  instructionIcon: $("#instructionIcon"),
  prevStep: $("#prevStep"),
  nextStep: $("#nextStep"),
  backToCorrection: $("#backToCorrection"),
  atlasGrid: $("#atlasGrid"),
  atlasCount: $("#atlasCount"),
  atlasCountInline: $("#atlasCountInline"),
  tileCountBadge: $("#tileCountBadge"),
  atlasCategorySelect: $("#atlasCategorySelect"),
  autoNextToggle: $("#autoNextToggle"),
  autoNextSeconds: $("#autoNextSeconds"),
  clearData: $("#clearData"),
  openAtlas: $("#openAtlas"),
  backHome: $("#backHome"),
  homeScreen: $("#homeScreen"),
  atlasScreen: $("#atlasScreen"),
  workCanvas: $("#workCanvas"),
  resultCanvas: $("#resultCanvas"),
  normalControls: $("#normalControls"),
  stepControls: $("#stepControls")
};

init();

async function init() {
  bindEvents();
  await loadAtlas();
  renderAtlas();
  renderBoard(els.correctionBoard, state.board);
  renderStep();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function bindEvents() {
  $$(".canvas-tab").forEach(button => {
    button.addEventListener("click", () => setCanvasMode(button.dataset.canvas));
  });

  els.imageInput.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadScreenshot(file);
  });

  els.recognizeButton.addEventListener("click", async () => {
    if (!state.image) return;
    await recognizeCurrentImage();
    setCanvasMode("correction");
  });

  els.solveButton.addEventListener("click", () => {
    solveCurrentBoard();
  });

  els.prevStep.addEventListener("click", () => {
    state.stepIndex = Math.max(0, state.stepIndex - 1);
    renderStep();
  });

  els.nextStep.addEventListener("click", () => {
    advanceStep();
  });

  els.backToCorrection.addEventListener("click", () => {
    showResult(false);
    setCanvasMode("correction");
  });

  els.openAtlas.addEventListener("click", () => showScreen("atlas"));
  els.backHome.addEventListener("click", () => showScreen("home"));

  els.savePreviewButton.addEventListener("click", () => {
    if (!state.image || !state.grid) return;
    const anchor = document.createElement("a");
    anchor.download = "砖王切割预览.png";
    anchor.href = els.previewCanvas.toDataURL("image/png");
    anchor.click();
  });

  els.atlasInput.addEventListener("change", async event => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      await addAtlasImage(file);
    }
    persistUserAtlas();
    renderAtlas();
    if (state.image) await recognizeCurrentImage();
  });

  els.autoNextToggle.addEventListener("change", syncAutoNext);
  els.autoNextSeconds.addEventListener("change", syncAutoNext);

  els.clearData.addEventListener("click", () => {
    if (!confirm("确定清空本地导入的图鉴吗？内置图鉴会自动恢复。")) return;
    localStorage.removeItem("brickking-user-atlas");
    location.reload();
  });
}

function showScreen(name) {
  els.homeScreen.classList.toggle("active", name === "home");
  els.atlasScreen.classList.toggle("active", name === "atlas");
}

function setCanvasMode(name) {
  state.canvasMode = name;
  $$(".canvas-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.canvas === name));
  $$(".canvas-pane").forEach(panel => panel.classList.toggle("active", panel.id === `canvas-${name}`));
}

function showResult(visible) {
  els.workCanvas.hidden = visible;
  els.resultCanvas.hidden = !visible;
  els.normalControls.hidden = visible;
  els.stepControls.hidden = !visible;
}

async function loadAtlas() {
  setStatus("加载图鉴", "正在准备浏览器端识别特征。");
  const res = await fetch("./assets/brickAtlas-60.json");
  const data = await res.json();
  const defaultEntries = await Promise.all((data.entries || []).map((entry, index) => atlasEntryFromData(entry, index + 1, false)));
  const userEntries = JSON.parse(localStorage.getItem("brickking-user-atlas") || "[]");
  const loadedUserEntries = await Promise.all(userEntries.map((entry, index) => atlasEntryFromData(entry, 10_000 + index, true)));
  state.atlas = [...defaultEntries, ...loadedUserEntries].filter(Boolean);
  setStatus("图鉴已就绪", `已加载 ${state.atlas.length} 个砖块模板。`);
}

async function atlasEntryFromData(entry, fallbackId, userAdded) {
  const imageData = entry.imageData?.startsWith("data:")
    ? entry.imageData
    : `data:image/png;base64,${entry.imageData}`;
  const image = await loadImage(imageData).catch(() => null);
  if (!image) return null;
  const feature = featureFromImage(image);
  return {
    id: Number(entry.numericId || entry.idNumber || fallbackId),
    uuid: entry.id || crypto.randomUUID(),
    name: entry.name || `砖块 ${fallbackId}`,
    imageData,
    image,
    feature,
    userAdded
  };
}

async function addAtlasImage(file) {
  const imageData = await readFileAsDataURL(file);
  const image = await loadImage(imageData);
  const id = Date.now() + Math.floor(Math.random() * 1000);
  state.atlas.push({
    id,
    uuid: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, "") || `砖块 ${id}`,
    imageData,
    image,
    feature: featureFromImage(image),
    userAdded: true
  });
}

function persistUserAtlas() {
  const userEntries = state.atlas
    .filter(entry => entry.userAdded)
    .map(entry => ({
      id: entry.uuid,
      numericId: entry.id,
      name: entry.name,
      imageData: entry.imageData
    }));
  try {
    localStorage.setItem("brickking-user-atlas", JSON.stringify(userEntries));
  } catch {
    alert("浏览器本地空间不够，部分图鉴可能无法保存。");
  }
}

function renderAtlas() {
  els.atlasCount.textContent = state.atlas.length;
  if (els.atlasCountInline) els.atlasCountInline.textContent = `${state.atlas.length} 个`;
  els.atlasGrid.innerHTML = "";
  for (const entry of state.atlas) {
    const item = document.createElement("div");
    item.className = "atlas-item";
    item.innerHTML = `<img alt="" src="${entry.imageData}"><span>${escapeHtml(entry.name)}</span>`;
    els.atlasGrid.appendChild(item);
  }
}

async function loadScreenshot(file) {
  setStatus("读取截图", "正在加载图片。");
  const src = await readFileAsDataURL(file);
  state.sourceDataURL = src;
  state.image = await loadImage(src);
  state.steps = [];
  state.stepBoards = [];
  state.stepIndex = 0;
  showResult(false);
  els.sourceImage.src = src;
  els.sourceImage.classList.add("visible");
  els.emptyPreview.style.display = "none";
  els.uploadButtonText.textContent = "更换截图";
  setCanvasMode("screenshot");
  await recognizeCurrentImage();
}

async function recognizeCurrentImage() {
  if (!state.image) return;
  const started = performance.now();
  state.grid = detectGrid(state.image);
  drawPreview();
  recognizeBoard();
  renderBoard(els.correctionBoard, state.board, { editable: true });
  const unknowns = state.board.filter(value => value >= 1_000_000).length;
  const count = tileCount(state.board);
  els.tileCountBadge.textContent = `${count} 块`;
  els.solveButton.disabled = count === 0;
  els.savePreviewButton.disabled = false;
  els.warningMessage.hidden = unknowns === 0;
  els.warningMessage.textContent = unknowns ? `还有 ${unknowns} 块未命中图鉴，可在校正页点格子调整。` : "";
  setStatus("识别完成", `用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒，未命中 ${unknowns} 块。`);
}

function detectGrid(image) {
  const canvas = makeCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  const stride = Math.max(1, Math.floor(Math.max(width, height) / 900));
  let minX = width, minY = height, maxX = 0, maxY = 0, hits = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (isTileInterior(r, g, b)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        hits += 1;
      }
    }
  }

  if (hits < 200) {
    const w = width * 0.94;
    return { x: (width - w) / 2, y: height * 0.24, w, h: w * ROWS / COLS };
  }

  const lineGrid = detectGridFromLineProjection({ minX, minY, maxX, maxY }, data, width, height);
  if (lineGrid) return tightenGridRect(lineGrid);

  const fallback = {
    x: minX - stride * 1.5,
    y: minY - stride * 1.5,
    w: maxX - minX + stride * 3,
    h: maxY - minY + stride * 3
  };
  return tightenGridRect(snapGridByLines(fallback, data, width, height));
}

function tightenGridRect(rect) {
  const cellW = rect.w / COLS;
  const cellH = rect.h / ROWS;
  const leftInset = cellW * 0.028;
  const rightInset = cellW * 0.028;
  const topInset = cellH * 0.02;
  const bottomInset = cellH * 0.09;
  return {
    ...rect,
    x: rect.x + leftInset,
    y: rect.y + topInset,
    w: Math.max(10, rect.w - leftInset - rightInset),
    h: Math.max(10, rect.h - topInset - bottomInset)
  };
}

function detectGridFromLineProjection(tileBox, data, width, height) {
  const tileW = tileBox.maxX - tileBox.minX;
  const tileH = tileBox.maxY - tileBox.minY;
  if (tileW < 80 || tileH < 120) return null;

  const roughCellW = tileW / COLS;
  const roughCellH = tileH / ROWS;
  const padX = Math.round(roughCellW * 0.65);
  const padY = Math.round(roughCellH * 0.65);
  const sx = Math.max(0, Math.round(tileBox.minX - padX));
  const ex = Math.min(width - 1, Math.round(tileBox.maxX + padX));
  const sy = Math.max(0, Math.round(tileBox.minY - padY));
  const ey = Math.min(height - 1, Math.round(tileBox.maxY + padY));

  const yStep = Math.max(1, Math.floor((ey - sy) / 520));
  const xStep = Math.max(1, Math.floor((ex - sx) / 520));
  const verticalScores = [];
  for (let x = sx; x <= ex; x++) {
    let score = 0;
    for (let y = sy; y <= ey; y += yStep) {
      const p = (y * width + x) * 4;
      if (isBoardSeparator(data[p], data[p + 1], data[p + 2])) score++;
    }
    verticalScores.push(score);
  }
  const horizontalScores = [];
  for (let y = sy; y <= ey; y++) {
    let score = 0;
    for (let x = sx; x <= ex; x += xStep) {
      const p = (y * width + x) * 4;
      if (isBoardSeparator(data[p], data[p + 1], data[p + 2])) score++;
    }
    horizontalScores.push(score);
  }

  const verticalPeaks = findLinePeaks(
    smoothScores(verticalScores, Math.max(1, Math.round(roughCellW * 0.025))),
    sx,
    roughCellW * 0.34
  );
  const horizontalPeaks = findLinePeaks(
    smoothScores(horizontalScores, Math.max(1, Math.round(roughCellH * 0.025))),
    sy,
    roughCellH * 0.34
  );

  const xGrid = chooseEquidistantGrid(verticalPeaks, COLS, tileBox.minX, tileBox.maxX);
  const yGrid = chooseEquidistantGrid(horizontalPeaks, ROWS, tileBox.minY, tileBox.maxY);
  if (!xGrid || !yGrid) return null;

  const rect = {
    x: xGrid.start,
    y: yGrid.start,
    w: xGrid.end - xGrid.start,
    h: yGrid.end - yGrid.start,
    confidence: Math.min(xGrid.confidence, yGrid.confidence)
  };
  const cellW = rect.w / COLS;
  const cellH = rect.h / ROWS;
  const aspect = cellW / cellH;
  if (aspect < 0.82 || aspect > 1.18 || rect.confidence < 0.38) return null;
  return rect;
}

function isBoardSeparator(r, g, b) {
  return isGridLine(r, g, b) || isBrownFrame(r, g, b);
}

function smoothScores(scores, radius) {
  const out = [];
  const prefix = [0];
  for (const score of scores) prefix.push(prefix[prefix.length - 1] + score);
  for (let i = 0; i < scores.length; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(scores.length - 1, i + radius);
    out.push((prefix[b + 1] - prefix[a]) / (b - a + 1));
  }
  return out;
}

function findLinePeaks(scores, offset, minDistance) {
  const maxScore = Math.max(...scores, 0);
  if (maxScore <= 0) return [];
  const threshold = maxScore * 0.45;
  const candidates = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] >= threshold) candidates.push({ score: scores[i], pos: offset + i });
  }
  candidates.sort((a, b) => b.score - a.score);
  const peaks = [];
  for (const candidate of candidates) {
    if (peaks.every(pos => Math.abs(pos - candidate.pos) > minDistance)) {
      peaks.push(candidate.pos);
    }
    if (peaks.length >= 50) break;
  }
  peaks.sort((a, b) => a - b);
  return peaks;
}

function chooseEquidistantGrid(peaks, divisions, roughStart, roughEnd) {
  if (peaks.length < 2) return null;
  const expectedCell = (roughEnd - roughStart) / divisions;
  let best = null;
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      const start = peaks[i];
      const end = peaks[j];
      const span = end - start;
      const cell = span / divisions;
      if (cell < expectedCell * 0.45 || cell > expectedCell * 1.55) continue;

      let hits = 0;
      let error = 0;
      for (let k = 0; k <= divisions; k++) {
        const target = start + cell * k;
        const nearest = peaks.reduce((bestDistance, pos) => Math.min(bestDistance, Math.abs(pos - target)), Infinity);
        if (nearest < cell * 0.18) {
          hits++;
          error += nearest / cell;
        } else {
          error += 1;
        }
      }
      const expectedPenalty = Math.abs(cell - expectedCell) / Math.max(1, expectedCell);
      const score = hits * 4 - error - expectedPenalty;
      const confidence = hits / (divisions + 1);
      if (!best || score > best.score) {
        best = { start, end, cell, hits, error, score, confidence };
      }
    }
  }
  return best;
}

function snapGridByLines(rect, data, width, height) {
  const searchX = Math.max(4, Math.round(rect.w / COLS * 0.28));
  const searchY = Math.max(4, Math.round(rect.h / ROWS * 0.28));
  const left = bestVerticalLine(rect.x, rect.y, rect.h, searchX, data, width, height);
  const right = bestVerticalLine(rect.x + rect.w, rect.y, rect.h, searchX, data, width, height);
  const top = bestHorizontalLine(rect.y, rect.x, rect.w, searchY, data, width, height);
  const bottom = bestHorizontalLine(rect.y + rect.h, rect.x, rect.w, searchY, data, width, height);
  const snapped = {
    x: left ?? rect.x,
    y: top ?? rect.y,
    w: (right ?? rect.x + rect.w) - (left ?? rect.x),
    h: (bottom ?? rect.y + rect.h) - (top ?? rect.y)
  };
  return {
    x: Math.max(0, snapped.x),
    y: Math.max(0, snapped.y),
    w: Math.max(10, snapped.w),
    h: Math.max(10, snapped.h)
  };
}

function bestVerticalLine(centerX, y, h, radius, data, width, height) {
  let best = null;
  for (let x = Math.max(0, Math.round(centerX - radius)); x <= Math.min(width - 1, Math.round(centerX + radius)); x++) {
    let score = 0;
    const samples = 90;
    for (let i = 0; i < samples; i++) {
      const yy = Math.round(y + h * i / (samples - 1));
      if (yy < 0 || yy >= height) continue;
      const p = (yy * width + x) * 4;
      if (isGridLine(data[p], data[p + 1], data[p + 2]) || isBrownFrame(data[p], data[p + 1], data[p + 2])) score++;
    }
    if (!best || score > best.score) best = { x, score };
  }
  return best && best.score > 20 ? best.x : null;
}

function bestHorizontalLine(centerY, x, w, radius, data, width, height) {
  let best = null;
  for (let y = Math.max(0, Math.round(centerY - radius)); y <= Math.min(height - 1, Math.round(centerY + radius)); y++) {
    let score = 0;
    const samples = 90;
    for (let i = 0; i < samples; i++) {
      const xx = Math.round(x + w * i / (samples - 1));
      if (xx < 0 || xx >= width) continue;
      const p = (y * width + xx) * 4;
      if (isGridLine(data[p], data[p + 1], data[p + 2]) || isBrownFrame(data[p], data[p + 1], data[p + 2])) score++;
    }
    if (!best || score > best.score) best = { y, score };
  }
  return best && best.score > 20 ? best.y : null;
}

function isTileInterior(r, g, b) {
  return r > 214 && g > 226 && b > 160 && g >= r - 10 && g > b + 22;
}

function isGridLine(r, g, b) {
  return g > 55 && g < 150 && r > 35 && r < 150 && b < 95 && g >= r - 35;
}

function isBrownFrame(r, g, b) {
  return r > 110 && r < 220 && g > 55 && g < 160 && b < 95 && r > g + 20;
}

function drawPreview() {
  const canvas = els.previewCanvas;
  const image = state.image;
  const grid = state.grid;
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  if (grid) {
    ctx.save();
    ctx.lineWidth = Math.max(2, image.naturalWidth / 360);
    ctx.strokeStyle = "#ffd100";
    ctx.strokeRect(grid.x, grid.y, grid.w, grid.h);
    ctx.strokeStyle = "rgba(255, 55, 75, .72)";
    ctx.lineWidth = Math.max(1, image.naturalWidth / 900);
    for (let c = 1; c < COLS; c++) {
      const x = grid.x + grid.w * c / COLS;
      ctx.beginPath();
      ctx.moveTo(x, grid.y);
      ctx.lineTo(x, grid.y + grid.h);
      ctx.stroke();
    }
    for (let r = 1; r < ROWS; r++) {
      const y = grid.y + grid.h * r / ROWS;
      ctx.beginPath();
      ctx.moveTo(grid.x, y);
      ctx.lineTo(grid.x + grid.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  els.emptyPreview.style.display = "none";
  if (els.emptyCutPreview) els.emptyCutPreview.style.display = "none";
  canvas.classList.add("visible");
}

function recognizeBoard() {
  const image = state.image;
  const grid = state.grid;
  if (!image || !grid) return;
  const canvas = makeCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const cellW = grid.w / COLS;
  const cellH = grid.h / ROWS;
  const nextBoard = [];
  const nextConfidence = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const rect = {
        x: grid.x + c * cellW,
        y: grid.y + r * cellH,
        w: cellW,
        h: cellH
      };
      if (isEmptyCell(ctx, rect)) {
        nextBoard.push(0);
        nextConfidence.push(1);
        continue;
      }
      const feature = featureFromCanvasRegion(ctx, rect);
      const match = matchAtlas(feature);
      if (match && match.distance <= DEFAULT_THRESHOLD) {
        nextBoard.push(match.id);
        nextConfidence.push(Math.max(0, 1 - match.distance / DEFAULT_THRESHOLD));
      } else {
        nextBoard.push(1_000_000 + r * COLS + c);
        nextConfidence.push(0);
      }
    }
  }
  state.board = nextBoard;
  state.confidence = nextConfidence;
}

function isEmptyCell(ctx, rect) {
  const image = ctx.getImageData(
    Math.max(0, Math.floor(rect.x + rect.w * 0.18)),
    Math.max(0, Math.floor(rect.y + rect.h * 0.18)),
    Math.max(1, Math.floor(rect.w * 0.64)),
    Math.max(1, Math.floor(rect.h * 0.64))
  );
  let brown = 0;
  let interior = 0;
  const total = image.data.length / 4;
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    if (r > 105 && r < 185 && g > 55 && g < 125 && b < 65) brown++;
    if (isTileInterior(r, g, b)) interior++;
  }
  return brown / total > 0.38 && interior / total < 0.18;
}

function matchAtlas(feature) {
  let best = null;
  let second = null;
  for (const entry of state.atlas) {
    const distance = rms(feature, entry.feature);
    if (!best || distance < best.distance) {
      second = best;
      best = { id: entry.id, entry, distance };
    } else if (!second || distance < second.distance) {
      second = { id: entry.id, entry, distance };
    }
  }
  if (!best) return null;
  if (second) {
    const gap = second.distance - best.distance;
    const ratio = best.distance / Math.max(second.distance, 0.0001);
    if (best.distance > 0.16 && gap < 0.012 && ratio > 0.94) return null;
  }
  return best;
}

function featureFromImage(image) {
  const canvas = makeCanvas(96, 96);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 96, 96);
  return featureFromCanvasRegion(ctx, { x: 0, y: 0, w: 96, h: 96 });
}

function featureFromCanvasRegion(ctx, rect) {
  const size = 8;
  const insetX = rect.w * 0.12;
  const insetY = rect.h * 0.12;
  const image = ctx.getImageData(
    Math.max(0, Math.floor(rect.x + insetX)),
    Math.max(0, Math.floor(rect.y + insetY)),
    Math.max(1, Math.floor(rect.w - insetX * 2)),
    Math.max(1, Math.floor(rect.h - insetY * 2))
  );
  const features = [];
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      const x0 = Math.floor(gx * image.width / size);
      const x1 = Math.floor((gx + 1) * image.width / size);
      const y0 = Math.floor(gy * image.height / size);
      const y1 = Math.floor((gy + 1) * image.height / size);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * image.width + x) * 4;
          sr += image.data[i] / 255;
          sg += image.data[i + 1] / 255;
          sb += image.data[i + 2] / 255;
          count++;
        }
      }
      const r = sr / Math.max(1, count);
      const g = sg / Math.max(1, count);
      const b = sb / Math.max(1, count);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      features.push(r, g, b, max - min);
    }
  }
  return features;
}

function renderBoard(container, board, options = {}) {
  container.innerHTML = "";
  const template = $("#cellTemplate");
  for (let i = 0; i < CELL_COUNT; i++) {
    const value = board[i] || 0;
    const cell = template.content.firstElementChild.cloneNode(true);
    if (value === 0) {
      cell.classList.add("empty");
      cell.disabled = true;
    } else {
      const entry = atlasById(value);
      if (entry) {
        const image = document.createElement("img");
        image.src = entry.imageData;
        image.alt = entry.name;
        cell.appendChild(image);
      } else {
        cell.innerHTML = `<span class="unknown">?</span>`;
      }
    }
    if (options.highlights?.has(i)) {
      cell.classList.add("highlight");
    }
    if (options.editable) {
      cell.addEventListener("click", () => {
        if (state.board[i] === 0) {
          state.board[i] = 1_000_000 + i;
        } else {
          state.board[i] = 0;
        }
        els.tileCountBadge.textContent = `${tileCount(state.board)} 块`;
        els.solveButton.disabled = tileCount(state.board) === 0;
        renderBoard(els.correctionBoard, state.board, { editable: true });
      });
    }
    container.appendChild(cell);
  }
}

function solveCurrentBoard() {
  const started = performance.now();
  const solver = new Solver(10_000);
  const result = solver.solve(state.board);
  state.steps = result.steps;
  state.stepBoards = [state.board];
  let cursor = state.board;
  for (const move of state.steps) {
    cursor = applyMove(cursor, move) || cursor;
    state.stepBoards.push(cursor);
  }
  state.stepIndex = 0;
  setStatus(result.solved ? "找到通关步骤" : "已返回最多步骤", `步骤 ${state.steps.length}，用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒。`);
  els.resultTitle.textContent = result.solved ? "通关步骤" : "最多可走步骤";
  els.resultSubtitle.textContent = result.solved
    ? "已找到完整通关路径。"
    : "已返回当前最好方案，剩余仍可能继续消除。";
  els.resultReason.textContent = result.solved
    ? "已找到完整通关方案。"
    : "已返回当前最好方案；剩余仍可能继续消除。";
  showResult(true);
  renderStep();
  syncAutoNext();
}

function renderStep() {
  const total = state.steps.length;
  els.stepCounter.textContent = total ? `${Math.min(state.stepIndex + 1, total)}/${total}` : "0/0";
  if (!total) {
    els.stepTitle.textContent = "还没有步骤";
    els.stepDescription.textContent = "完成识别后点击开始分析。";
    els.stepCounter.textContent = "0/0";
    renderBoard(els.stepBoard, state.board);
    return;
  }
  const move = state.steps[Math.min(state.stepIndex, total - 1)];
  els.stepTitle.textContent = move.type === "remove" ? "直接点掉两块" : `向${directionLabel(move.direction)}拖 ${move.distance} 格`;
  els.stepDescription.textContent = describeMove(move);
  const board = state.stepBoards[state.stepIndex] || state.board;
  renderBoard(els.stepBoard, board, { highlights: highlightedIndexes(move) });
}

function highlightedIndexes(move) {
  const set = new Set();
  if (move.type === "remove") {
    set.add(idx(move.a.row, move.a.col));
    set.add(idx(move.b.row, move.b.col));
  } else {
    set.add(idx(move.start.row, move.start.col));
    set.add(idx(move.target.row, move.target.col));
  }
  return set;
}

function describeMove(move) {
  if (move.type === "remove") {
    return `高亮的两个格子：R${move.a.row + 1}C${move.a.col + 1} 和 R${move.b.row + 1}C${move.b.col + 1}。`;
  }
  return `按住 R${move.start.row + 1}C${move.start.col + 1}，向${directionLabel(move.direction)}拖动，消除目标 R${move.target.row + 1}C${move.target.col + 1}。`;
}

function advanceStep() {
  if (!state.steps.length) return;
  state.stepIndex = Math.min(state.steps.length - 1, state.stepIndex + 1);
  renderStep();
}

function syncAutoNext() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
  if (!els.autoNextToggle.checked || !state.steps.length) return;
  const seconds = clamp(Number(els.autoNextSeconds.value) || 3, 1, 20);
  state.autoTimer = setInterval(() => {
    if (state.stepIndex >= state.steps.length - 1) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
      return;
    }
    advanceStep();
  }, seconds * 1000);
}

class Solver {
  constructor(timeLimitMs = 10_000) {
    this.deadline = performance.now() + timeLimitMs;
  }

  solve(initial) {
    const strategies = ["balanced", "dragEarly", "directFirst", "mobility", "shortDrag"];
    let best = { steps: [], board: initial, solved: false };
    for (const strategy of strategies) {
      const run = this.solveGreedy(initial, strategy);
      if (run.solved || run.steps.length > best.steps.length || tileCount(run.board) < tileCount(best.board)) best = run;
      if (best.solved || performance.now() > this.deadline) break;
    }
    return best;
  }

  solveGreedy(initial, strategy) {
    let board = initial.slice();
    const visited = new Set([boardKey(board)]);
    const steps = [];
    while (performance.now() < this.deadline && tileCount(board) > 0) {
      const candidates = legalMoves(board)
        .map(move => ({ move, board: applyMove(board, move) }))
        .filter(next => next.board && !visited.has(boardKey(next.board)))
        .sort((a, b) => scoreCandidate(b, strategy, steps.length + 1) - scoreCandidate(a, strategy, steps.length + 1));
      if (!candidates.length) break;
      const chosen = candidates[0];
      steps.push(chosen.move);
      board = chosen.board;
      visited.add(boardKey(board));
    }
    return { steps, board, solved: tileCount(board) === 0 };
  }
}

function legalMoves(board) {
  return [...directMoves(board), ...dragMoves(board)];
}

function directMoves(board) {
  const moves = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!board[i]) continue;
    const a = pos(i);
    for (let j = i + 1; j < CELL_COUNT; j++) {
      if (board[i] !== board[j]) continue;
      const b = pos(j);
      if (clearLine(board, a, b)) moves.push({ type: "remove", a, b });
    }
  }
  return moves;
}

function dragMoves(board) {
  const moves = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (!board[i]) continue;
    for (const direction of ["up", "down", "left", "right"]) {
      const move = legalDragMove(board, pos(i), direction);
      if (move) moves.push(move);
    }
  }
  return moves;
}

function legalDragMove(board, start, direction) {
  const icon = board[idx(start.row, start.col)];
  if (!icon) return null;
  const train = dragTrain(board, start, direction);
  if (!train.length) return null;
  const originalTrain = new Set(train.map(p => idx(p.row, p.col)));
  const candidates = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    if (board[i] === icon && !originalTrain.has(i)) candidates.push(pos(i));
  }
  let distance = 0;
  while (true) {
    const nextTrain = train.map(p => movePos(p, direction, distance + 1));
    if (!nextTrain.every(contains)) return null;
    const currentTrain = new Set(train.map(p => idx(movePos(p, direction, distance).row, movePos(p, direction, distance).col)));
    const canMove = nextTrain.every(p => currentTrain.has(idx(p.row, p.col)) || !board[idx(p.row, p.col)]);
    if (!canMove) return null;
    distance += 1;
    const shifted = shiftTrain(board, train, direction, distance);
    const held = movePos(start, direction, distance);
    const moved = new Set(train.map(p => idx(movePos(p, direction, distance).row, movePos(p, direction, distance).col)));
    for (const target of candidates) {
      if (moved.has(idx(target.row, target.col))) continue;
      if (isBehind(target, held, direction)) continue;
      if (shifted[idx(target.row, target.col)] === icon && clearLine(shifted, held, target)) {
        return { type: "drag", start, direction, distance, target };
      }
    }
  }
}

function applyMove(board, move) {
  const next = board.slice();
  if (move.type === "remove") {
    const ai = idx(move.a.row, move.a.col), bi = idx(move.b.row, move.b.col);
    if (!next[ai] || next[ai] !== next[bi] || !clearLine(board, move.a, move.b)) return null;
    next[ai] = 0;
    next[bi] = 0;
    return next;
  }
  const legal = legalDragMove(board, move.start, move.direction);
  if (!legal || legal.distance !== move.distance || idx(legal.target.row, legal.target.col) !== idx(move.target.row, move.target.col)) return null;
  const train = dragTrain(board, move.start, move.direction);
  const shifted = shiftTrain(board, train, move.direction, move.distance);
  const held = movePos(move.start, move.direction, move.distance);
  shifted[idx(held.row, held.col)] = 0;
  shifted[idx(move.target.row, move.target.col)] = 0;
  return shifted;
}

function shiftTrain(board, train, direction, distance) {
  const next = board.slice();
  for (const p of train) next[idx(p.row, p.col)] = 0;
  for (const p of train) {
    const to = movePos(p, direction, distance);
    next[idx(to.row, to.col)] = board[idx(p.row, p.col)];
  }
  return next;
}

function dragTrain(board, start, direction) {
  const train = [];
  let p = start;
  while (contains(p) && board[idx(p.row, p.col)]) {
    train.push(p);
    p = movePos(p, direction, 1);
  }
  return train;
}

function clearLine(board, a, b) {
  if (a.row === b.row) {
    for (let c = Math.min(a.col, b.col) + 1; c < Math.max(a.col, b.col); c++) {
      if (board[idx(a.row, c)]) return false;
    }
    return true;
  }
  if (a.col === b.col) {
    for (let r = Math.min(a.row, b.row) + 1; r < Math.max(a.row, b.row); r++) {
      if (board[idx(r, a.col)]) return false;
    }
    return true;
  }
  return false;
}

function scoreCandidate(candidate, strategy, stepNumber) {
  const moves = legalMoves(candidate.board).length;
  const direct = directMoves(candidate.board).length;
  let score = moves * 8 + direct * 5 - tileCount(candidate.board);
  const drag = candidate.move.type === "drag";
  const preferDrag = strategy === "dragEarly" || (stepNumber >= 3 && stepNumber <= 20 && tileCount(candidate.board) >= 80);
  if (drag && preferDrag) score += 220;
  if (!drag && strategy === "directFirst") score += 220;
  if (strategy === "mobility") score += moves * 18;
  if (strategy === "shortDrag" && drag) score += Math.max(0, 120 - candidate.move.distance * 20);
  if (tileCount(candidate.board) === 0) score += 1_000_000;
  return score;
}

function isBehind(target, held, direction) {
  const d = delta(direction);
  if (d.row && target.col === held.col) return (target.row - held.row) * d.row < 0;
  if (d.col && target.row === held.row) return (target.col - held.col) * d.col < 0;
  return false;
}

function delta(direction) {
  return {
    up: { row: -1, col: 0 },
    down: { row: 1, col: 0 },
    left: { row: 0, col: -1 },
    right: { row: 0, col: 1 }
  }[direction];
}

function movePos(p, direction, distance) {
  const d = delta(direction);
  return { row: p.row + d.row * distance, col: p.col + d.col * distance };
}

function directionLabel(direction) {
  return { up: "上", down: "下", left: "左", right: "右" }[direction] || "";
}

function contains(p) {
  return p.row >= 0 && p.row < ROWS && p.col >= 0 && p.col < COLS;
}

function idx(row, col) {
  return row * COLS + col;
}

function pos(index) {
  return { row: Math.floor(index / COLS), col: index % COLS };
}

function tileCount(board) {
  return board.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function boardKey(board) {
  return board.join(",");
}

function atlasById(id) {
  return state.atlas.find(entry => entry.id === id);
}

function rms(a, b) {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / Math.max(1, n));
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(title, text) {
  els.statusText.textContent = text || title || "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}
