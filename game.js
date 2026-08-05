"use strict";

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;               // 논리 단위. 실제 픽셀은 DPR에 맞춰 확대된다.
const LOCK_DELAY = 420;
const CLEAR_DELAY = 180;        // 줄 삭제 연출 시간
const DAS = 150;                // 키를 누른 뒤 자동 반복이 시작되기까지
const ARR = 40;                 // 자동 반복 간격
const SOFT_ARR = 45;
const LINE_POINTS = [0, 100, 300, 500, 800];
const NEXT_COUNT = 3;

const COLORS = {
  I: "#33d4e7",
  J: "#5d7cff",
  L: "#ff9f43",
  O: "#f6d84e",
  S: "#5bd85b",
  T: "#b66dff",
  Z: "#ff5d6c",
};

// 각 조각은 정사각 박스 안의 좌표로 정의한다. 박스가 고정되어 있어야
// 회전을 반복해도 제자리로 돌아온다. I는 4칸 박스의 1행에 둔다.
const BOX = { I: 4, J: 3, L: 3, O: 3, S: 3, T: 3, Z: 3 };

const SHAPES = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

// 회전 실패 시 시도할 보정값. 좌우뿐 아니라 위로도 밀어본다(바닥 킥).
const KICKS = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1], [0, -2],
];
const KICKS_I = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, -1], [0, -2],
];

const boardCanvas = document.querySelector("#board");
const boardCtx = boardCanvas.getContext("2d");
const nextCanvas = document.querySelector("#next");
const nextCtx = nextCanvas.getContext("2d");
const holdCanvas = document.querySelector("#hold");
const holdCtx = holdCanvas.getContext("2d");

const scoreEl = document.querySelector("#score");
const bestEl = document.querySelector("#best");
const levelEl = document.querySelector("#level");
const linesEl = document.querySelector("#lines");
const overlay = document.querySelector("#overlay");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayText = document.querySelector("#overlayText");
const overlayButton = document.querySelector("#overlayButton");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const soundButton = document.querySelector("#soundButton");

let board;
let bag;
let queue;
let current;
let hold;
let canHold;
let score;
let level;
let lines;
let isRunning;
let isPaused;
let isGameOver;
let dropCounter;
let lastTime;
let lockTimer;
let bestScore;
let clearingRows = null;
let clearTimer = 0;

let audioContext;
let musicTimer;
let musicStep;
let isSoundEnabled;
let nextNoteTime;

// 좌우/아래 자동 반복 상태
const repeat = { dir: 0, timer: 0, charged: false };
const softRepeat = { active: false, timer: 0 };

const melody = [
  ["E5", 0.5], ["B4", 0.25], ["C5", 0.25], ["D5", 0.5], ["C5", 0.25], ["B4", 0.25],
  ["A4", 0.5], ["A4", 0.25], ["C5", 0.25], ["E5", 0.5], ["D5", 0.25], ["C5", 0.25],
  ["B4", 0.75], ["C5", 0.25], ["D5", 0.5], ["E5", 0.5],
  ["C5", 0.5], ["A4", 0.5], ["A4", 0.75], [null, 0.25],
  ["D5", 0.5], ["F5", 0.25], ["A5", 0.5], ["G5", 0.25], ["F5", 0.25],
  ["E5", 0.75], ["C5", 0.25], ["E5", 0.5], ["D5", 0.25], ["C5", 0.25],
  ["B4", 0.5], ["B4", 0.25], ["C5", 0.25], ["D5", 0.5], ["E5", 0.5],
  ["C5", 0.5], ["A4", 0.5], ["A4", 0.75], [null, 0.25],
];

/* ---------------------------------------------------------------- 캔버스 */

// CSS로 잡힌 실제 크기 × 화면 배율만큼 백버퍼를 잡고, 그리기는 논리 좌표로.
function fitCanvas(canvas, logicalWidth, logicalHeight) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return 1;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  const scale = canvas.width / logicalWidth;
  ctx.setTransform(scale, 0, 0, canvas.height / logicalHeight, 0, 0);
  return scale;
}

let boardScale = 1;

function fitAllCanvases() {
  boardScale = fitCanvas(boardCanvas, COLS * BLOCK, ROWS * BLOCK);
  fitCanvas(holdCanvas, 112, 168);
  fitCanvas(nextCanvas, 112, 168);
  drawBoard();
  updatePreviews();
}

/* ------------------------------------------------------------------ 저장 */

function loadBestScore() {
  try {
    return Number(localStorage.getItem("classic-tetris-best")) || 0;
  } catch {
    return 0;
  }
}

function saveBestScore(value) {
  try {
    localStorage.setItem("classic-tetris-best", String(value));
  } catch {
    // 시크릿 모드 등에서 저장이 막혀도 현재 세션 기록은 유지된다.
  }
}

/* -------------------------------------------------------------- 소리 */

function noteFrequency(note) {
  if (!note) return 0;
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  const semitones = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };
  return 440 * (2 ** ((semitones[name] + (Number(octave) - 4) * 12) / 12));
}

function ensureAudio() {
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function scheduleNote(note, start, duration, volume = 0.055, type = "square") {
  if (!note || !audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  osc.type = type;
  osc.frequency.value = typeof note === "number" ? note : noteFrequency(note);
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.92);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(start);
  osc.stop(start + duration);
}

const SFX = {
  move:   [{ f: 220, d: 0.03, v: 0.03 }],
  rotate: [{ f: 420, d: 0.05, v: 0.035 }],
  lock:   [{ f: 150, d: 0.07, v: 0.05 }],
  hold:   [{ f: 520, d: 0.06, v: 0.035 }],
  clear:  [{ f: 660, d: 0.08, v: 0.05 }, { f: 880, d: 0.1, v: 0.05, at: 0.07 }],
  tetris: [{ f: 660, d: 0.08, v: 0.06 }, { f: 880, d: 0.08, v: 0.06, at: 0.07 },
           { f: 1180, d: 0.16, v: 0.06, at: 0.14 }],
  over:   [{ f: 320, d: 0.16, v: 0.05 }, { f: 240, d: 0.2, v: 0.05, at: 0.14 },
           { f: 160, d: 0.32, v: 0.05, at: 0.3 }],
};

function playSfx(name) {
  if (!isSoundEnabled || !audioContext) return;
  const now = audioContext.currentTime;
  SFX[name].forEach(({ f, d, v, at = 0 }) => {
    scheduleNote(f, now + at, d, v, "triangle");
  });
}

function scheduleMusic() {
  if (!audioContext || !isSoundEnabled) return;
  const beat = 0.26;
  while (nextNoteTime < audioContext.currentTime + 0.55) {
    const [note, beats] = melody[musicStep % melody.length];
    scheduleNote(note, nextNoteTime, beats * beat);
    nextNoteTime += beats * beat;
    musicStep += 1;
  }
}

function startMusic() {
  if (!isSoundEnabled) return;
  ensureAudio();
  if (musicTimer) return;
  nextNoteTime = audioContext.currentTime + 0.04;
  musicTimer = setInterval(scheduleMusic, 90);
  scheduleMusic();
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

function toggleSound() {
  isSoundEnabled = !isSoundEnabled;
  if (isSoundEnabled) ensureAudio();
  soundButton.textContent = isSoundEnabled ? "Sound: On" : "Sound: Off";
  soundButton.setAttribute("aria-pressed", String(isSoundEnabled));
  if (isSoundEnabled && isRunning && !isPaused && !isGameOver) startMusic();
  else stopMusic();
}

/* ------------------------------------------------------------------ 조각 */

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function refillQueue() {
  while (queue.length < NEXT_COUNT + 1) {
    if (!bag.length) bag = shuffle(Object.keys(SHAPES));
    queue.push(bag.pop());
  }
}

function makePiece(type) {
  const cells = SHAPES[type].map(([x, y]) => ({ x, y }));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return { type, x: 3, y: -minY, cells };
}

function rotateCells(cells, type, clockwise) {
  const size = BOX[type];
  return clockwise
    ? cells.map(({ x, y }) => ({ x: size - 1 - y, y: x }))
    : cells.map(({ x, y }) => ({ x: y, y: size - 1 - x }));
}

function pieceCells(piece, cells = piece.cells, offsetX = 0, offsetY = 0) {
  return cells.map(({ x, y }) => ({
    x: piece.x + x + offsetX,
    y: piece.y + y + offsetY,
  }));
}

function collides(piece, offsetX = 0, offsetY = 0, cells = piece.cells) {
  return pieceCells(piece, cells, offsetX, offsetY).some(({ x, y }) => (
    x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x])
  ));
}

/* ------------------------------------------------------------------ 그리기 */

function drawCell(ctx, x, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(x * size + 2, y * size + 2, size - 4, 3);
  ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
  ctx.fillRect(x * size + 2, y * size + size - 5, size - 4, 3);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
  ctx.lineWidth = 1 / boardScale;
  ctx.strokeRect(x * size, y * size, size, size);
  ctx.globalAlpha = 1;
}

function drawGrid() {
  boardCtx.fillStyle = "#0b1012";
  boardCtx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);
  boardCtx.strokeStyle = "#273237";
  boardCtx.lineWidth = 1 / boardScale;
  for (let x = 0; x <= COLS; x += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * BLOCK, 0);
    boardCtx.lineTo(x * BLOCK, ROWS * BLOCK);
    boardCtx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y * BLOCK);
    boardCtx.lineTo(COLS * BLOCK, y * BLOCK);
    boardCtx.stroke();
  }
}

function drawBoard() {
  drawGrid();

  board.forEach((row, y) => {
    row.forEach((type, x) => {
      if (type) drawCell(boardCtx, x, y, BLOCK, COLORS[type]);
    });
  });

  // 줄 삭제 연출: 사라질 줄을 흰색으로 덮었다가 서서히 지운다.
  if (clearingRows) {
    const progress = Math.min(1, clearTimer / CLEAR_DELAY);
    boardCtx.fillStyle = `rgba(255, 255, 255, ${0.85 * (1 - progress)})`;
    clearingRows.forEach((y) => {
      const inset = (BLOCK * 0.5) * progress;
      boardCtx.fillRect(inset, y * BLOCK, COLS * BLOCK - inset * 2, BLOCK);
    });
    return;
  }

  if (current && isRunning) {
    const ghost = { ...current };
    while (!collides(ghost, 0, 1)) ghost.y += 1;
    pieceCells(ghost).forEach(({ x, y }) => {
      if (y >= 0) drawCell(boardCtx, x, y, BLOCK, COLORS[current.type], 0.22);
    });
    pieceCells(current).forEach(({ x, y }) => {
      if (y >= 0) drawCell(boardCtx, x, y, BLOCK, COLORS[current.type]);
    });
  }
}

// 캔버스 크기와 블록 크기가 나누어떨어지지 않아도 정확히 가운데 오도록
// 소수점 오프셋을 그대로 쓴다.
function drawPieceAt(ctx, type, centerX, centerY, size) {
  const cells = SHAPES[type];
  const xs = cells.map((cell) => cell[0]);
  const ys = cells.map((cell) => cell[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = (Math.max(...xs) - minX + 1) * size;
  const height = (Math.max(...ys) - minY + 1) * size;
  const originX = centerX - width / 2 - minX * size;
  const originY = centerY - height / 2 - minY * size;

  ctx.save();
  ctx.translate(originX, originY);
  cells.forEach(([x, y]) => drawCell(ctx, x, y, size, COLORS[type]));
  ctx.restore();
}

function clearPanelCanvas(ctx) {
  ctx.fillStyle = "#111719";
  ctx.fillRect(0, 0, 112, 168);
}

function updatePreviews() {
  clearPanelCanvas(holdCtx);
  if (hold) drawPieceAt(holdCtx, hold, 56, 84, 26);

  clearPanelCanvas(nextCtx);
  // 맨 위가 바로 다음 조각이라 조금 크게 그린다.
  const slots = [
    { y: 34, size: 26 },
    { y: 92, size: 18 },
    { y: 138, size: 18 },
  ];
  queue.slice(0, NEXT_COUNT).forEach((type, index) => {
    const slot = slots[index];
    if (slot) drawPieceAt(nextCtx, type, 56, slot.y, slot.size);
  });
}

function updatePanel() {
  if (score > bestScore) {
    bestScore = score;
    saveBestScore(bestScore);
  }
  scoreEl.textContent = score.toLocaleString("en-US");
  bestEl.textContent = bestScore.toLocaleString("en-US");
  levelEl.textContent = level;
  linesEl.textContent = lines;
  updatePreviews();
  pauseButton.disabled = !isRunning || isGameOver;
  pauseButton.textContent = isPaused ? "Resume" : "Pause";
  startButton.textContent = isRunning && !isGameOver ? "Restart" : "Start";
}

function setOverlay(visible, title, text) {
  overlay.classList.toggle("is-visible", visible);
  overlay.setAttribute("aria-hidden", String(!visible));
  if (title) overlayTitle.textContent = title;
  if (text) overlayText.textContent = text;
}

/* ------------------------------------------------------------------ 진행 */

function spawnPiece() {
  refillQueue();
  current = makePiece(queue.shift());
  refillQueue();
  canHold = true;
  lockTimer = 0;
  dropCounter = 0;
  if (collides(current)) endGame();
}

function mergePiece() {
  pieceCells(current).forEach(({ x, y }) => {
    if (y >= 0) board[y][x] = current.type;
  });
}

function findFullRows() {
  const rows = [];
  for (let y = 0; y < ROWS; y += 1) {
    if (board[y].every(Boolean)) rows.push(y);
  }
  return rows;
}

function removeRows(rows) {
  rows
    .slice()
    .sort((a, b) => a - b)
    .forEach((y) => {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(null));
    });

  const cleared = rows.length;
  lines += cleared;
  level = Math.floor(lines / 10) + 1;
  score += LINE_POINTS[cleared] * level;
}

function lockPiece() {
  mergePiece();
  current = null;
  const full = findFullRows();

  if (full.length) {
    clearingRows = full;
    clearTimer = 0;
    playSfx(full.length === 4 ? "tetris" : "clear");
  } else {
    playSfx("lock");
    spawnPiece();
  }
  updatePanel();
}

function finishClear() {
  removeRows(clearingRows);
  clearingRows = null;
  spawnPiece();
  updatePanel();
}

function canAct() {
  return isRunning && !isPaused && !isGameOver && current && !clearingRows;
}

function move(dx, silent = false) {
  if (!canAct()) return false;
  if (collides(current, dx, 0)) return false;
  current.x += dx;
  lockTimer = 0;
  if (!silent) playSfx("move");
  drawBoard();
  return true;
}

function softDrop() {
  if (!canAct()) return;
  if (!collides(current, 0, 1)) {
    current.y += 1;
    score += 1;
    updatePanel();
  } else {
    lockPiece();
  }
  dropCounter = 0;
  drawBoard();
}

function hardDrop() {
  if (!canAct()) return;
  let distance = 0;
  while (!collides(current, 0, 1)) {
    current.y += 1;
    distance += 1;
  }
  score += distance * 2;
  lockPiece();
  drawBoard();
}

function rotate(clockwise = true) {
  if (!canAct() || current.type === "O") return;
  const rotated = rotateCells(current.cells, current.type, clockwise);
  const kicks = current.type === "I" ? KICKS_I : KICKS;
  const kick = kicks.find(([dx, dy]) => !collides(current, dx, dy, rotated));
  if (!kick) return;
  current.cells = rotated;
  current.x += kick[0];
  current.y += kick[1];
  lockTimer = 0;
  playSfx("rotate");
  drawBoard();
}

function holdPiece() {
  if (!canAct() || !canHold) return;
  const type = current.type;
  if (hold) {
    current = makePiece(hold);
    hold = type;
    lockTimer = 0;
    dropCounter = 0;
    if (collides(current)) {
      endGame();
      drawBoard();
      return;
    }
  } else {
    hold = type;
    spawnPiece();
  }
  canHold = false;
  playSfx("hold");
  updatePanel();
  drawBoard();
}

function dropInterval() {
  return Math.max(60, 800 * (0.85 ** (level - 1)));
}

function clearRepeats() {
  repeat.dir = 0;
  repeat.timer = 0;
  repeat.charged = false;
  softRepeat.active = false;
  softRepeat.timer = 0;
}

// 좌우·아래 자동 반복. OS 키 반복에 맡기면 첫 반복까지 0.5초쯤 걸려 답답하다.
function handleRepeats(delta) {
  if (repeat.dir) {
    repeat.timer += delta;
    if (!repeat.charged) {
      if (repeat.timer >= DAS) {
        repeat.charged = true;
        repeat.timer = 0;
        move(repeat.dir, true);
      }
    } else {
      while (repeat.timer >= ARR) {
        repeat.timer -= ARR;
        if (!move(repeat.dir, true)) break;
      }
    }
  }

  if (softRepeat.active) {
    softRepeat.timer += delta;
    while (softRepeat.timer >= SOFT_ARR) {
      softRepeat.timer -= SOFT_ARR;
      softDrop();
    }
  }
}

function gameLoop(time = 0) {
  const delta = Math.min(time - lastTime, 100);   // 탭 복귀 시 폭주 방지
  lastTime = time;

  if (isRunning && !isPaused && !isGameOver) {
    if (clearingRows) {
      clearTimer += delta;
      if (clearTimer >= CLEAR_DELAY) finishClear();
    } else if (current) {
      handleRepeats(delta);
      dropCounter += delta;
      if (collides(current, 0, 1)) {
        lockTimer += delta;
        if (lockTimer >= LOCK_DELAY) lockPiece();
      } else if (dropCounter >= dropInterval()) {
        current.y += 1;
        dropCounter = 0;
        lockTimer = 0;
      }
    }
    drawBoard();
  }

  requestAnimationFrame(gameLoop);
}

function startGame() {
  board = createBoard();
  bag = [];
  queue = [];
  score = 0;
  level = 1;
  lines = 0;
  hold = null;
  canHold = true;
  isRunning = true;
  isPaused = false;
  isGameOver = false;
  dropCounter = 0;
  lastTime = performance.now();
  lockTimer = 0;
  clearingRows = null;
  musicStep = 0;
  clearRepeats();
  refillQueue();
  spawnPiece();
  setOverlay(false);
  updatePanel();
  drawBoard();
  startMusic();
}

// 진행 중인 판이 아까울 수 있으니 한 번 확인한다.
function requestStart() {
  if (isRunning && !isGameOver && score > 0) {
    if (!window.confirm("진행 중인 게임을 버리고 새로 시작할까요?")) return;
  }
  startGame();
}

function togglePause(force) {
  if (!isRunning || isGameOver) return;
  const nextPaused = force === undefined ? !isPaused : force;
  if (nextPaused === isPaused) return;
  isPaused = nextPaused;
  clearRepeats();
  setOverlay(isPaused, "Paused", "P 또는 Resume으로 계속");
  overlayButton.textContent = "Resume";
  if (isPaused) stopMusic();
  else {
    lastTime = performance.now();
    startMusic();
  }
  updatePanel();
}

function endGame() {
  isGameOver = true;
  isRunning = false;
  clearRepeats();
  setOverlay(true, "Game Over", `${score.toLocaleString("en-US")}점 · 최고 ${Math.max(score, bestScore).toLocaleString("en-US")}점`);
  overlayButton.textContent = "Restart";
  stopMusic();
  playSfx("over");
  updatePanel();
}

/* ------------------------------------------------------------------ 입력 */

const KEY_ACTIONS = {
  ArrowLeft: () => startMoveRepeat(-1),
  ArrowRight: () => startMoveRepeat(1),
  ArrowDown: () => startSoftRepeat(),
  ArrowUp: () => rotate(true),
  KeyX: () => rotate(true),
  KeyZ: () => rotate(false),
  Space: () => hardDrop(),
  KeyC: () => holdPiece(),
  KeyP: () => togglePause(),
  Enter: () => {
    if (!isRunning || isGameOver) startGame();
    else if (isPaused) togglePause(false);
  },
};

function startMoveRepeat(dir) {
  if (!move(dir)) {
    repeat.dir = dir;
    repeat.timer = 0;
    repeat.charged = false;
    return;
  }
  repeat.dir = dir;
  repeat.timer = 0;
  repeat.charged = false;
}

function stopMoveRepeat(dir) {
  if (repeat.dir === dir) {
    repeat.dir = 0;
    repeat.charged = false;
  }
}

function startSoftRepeat() {
  softDrop();
  softRepeat.active = true;
  softRepeat.timer = 0;
}

function stopSoftRepeat() {
  softRepeat.active = false;
  softRepeat.timer = 0;
}

function handleKeydown(event) {
  if (!(event.code in KEY_ACTIONS)) return;
  event.preventDefault();
  if (event.repeat) return;          // 반복은 직접 처리한다
  KEY_ACTIONS[event.code]();
}

function handleKeyup(event) {
  if (event.code === "ArrowLeft") stopMoveRepeat(-1);
  if (event.code === "ArrowRight") stopMoveRepeat(1);
  if (event.code === "ArrowDown") stopSoftRepeat();
}

// 버튼을 누른 채로 두면 반복되도록. 클릭 대신 포인터 이벤트를 쓴다.
function bindTouchControls() {
  const held = new Map();

  document.querySelectorAll("[data-action]").forEach((button) => {
    const action = button.dataset.action;

    const press = (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      if (action === "left") startMoveRepeat(-1);
      else if (action === "right") startMoveRepeat(1);
      else if (action === "down") startSoftRepeat();
      else if (action === "rotate") rotate(true);
      else if (action === "counter") rotate(false);
      else if (action === "hold") holdPiece();
      else if (action === "drop") hardDrop();
      held.set(button, action);
    };

    const release = () => {
      if (!held.has(button)) return;
      if (action === "left") stopMoveRepeat(-1);
      else if (action === "right") stopMoveRepeat(1);
      else if (action === "down") stopSoftRepeat();
      held.delete(button);
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  });
}

/* ------------------------------------------------------------------ 시작 */

function bindButton(button, handler) {
  button.addEventListener("click", () => {
    handler();
    button.blur();   // 이후 Space/Enter가 버튼을 다시 누르지 않도록
  });
}

bindButton(startButton, requestStart);
bindButton(pauseButton, () => togglePause());
bindButton(soundButton, toggleSound);
bindButton(overlayButton, () => {
  if (isPaused) togglePause(false);
  else startGame();
});

window.addEventListener("keydown", handleKeydown);
window.addEventListener("keyup", handleKeyup);
window.addEventListener("blur", clearRepeats);
window.addEventListener("resize", fitAllCanvases);

// 탭을 벗어나면 자동 일시정지. 돌아왔을 때 블록이 즉사하지 않는다.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) togglePause(true);
});

bindTouchControls();

board = createBoard();
bag = [];
queue = [];
current = null;
hold = null;
score = 0;
level = 1;
lines = 0;
isRunning = false;
isPaused = false;
isGameOver = false;
dropCounter = 0;
lastTime = 0;
lockTimer = 0;
bestScore = loadBestScore();
musicStep = 0;
isSoundEnabled = false;
nextNoteTime = 0;

refillQueue();
fitAllCanvases();
updatePanel();
requestAnimationFrame(gameLoop);
