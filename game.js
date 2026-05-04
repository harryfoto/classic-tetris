"use strict";

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const PREVIEW_BLOCK = 24;
const LOCK_DELAY = 420;
const LINE_POINTS = [0, 100, 300, 500, 800];

const COLORS = {
  I: "#33d4e7",
  J: "#5d7cff",
  L: "#ff9f43",
  O: "#f6d84e",
  S: "#5bd85b",
  T: "#b66dff",
  Z: "#ff5d6c",
};

const SHAPES = {
  I: [[0, 0], [1, 0], [2, 0], [3, 0]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
};

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
const overlayText = document.querySelector("#overlayText");
const overlayButton = document.querySelector("#overlayButton");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const resetButton = document.querySelector("#resetButton");
const musicButton = document.querySelector("#musicButton");

let board;
let bag;
let current;
let next;
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
let animationId;
let bestScore;
let audioContext;
let musicTimer;
let musicStep;
let isMusicEnabled;
let nextNoteTime;

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

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

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
    // Some privacy modes disable storage; the current session still tracks best score.
  }
}

function noteFrequency(note) {
  if (!note) return 0;
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  const semitones = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 };
  return 440 * (2 ** ((semitones[name] + (Number(octave) - 4) * 12) / 12));
}

function scheduleNote(note, start, duration) {
  if (!note || !audioContext) return;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  osc.type = "square";
  osc.frequency.value = noteFrequency(note);
  filter.type = "lowpass";
  filter.frequency.value = 1500;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.055, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.92);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  osc.start(start);
  osc.stop(start + duration);
}

function scheduleMusic() {
  if (!audioContext || !isMusicEnabled) return;
  const beat = 0.26;
  while (nextNoteTime < audioContext.currentTime + 0.55) {
    const [note, beats] = melody[musicStep % melody.length];
    scheduleNote(note, nextNoteTime, beats * beat);
    nextNoteTime += beats * beat;
    musicStep += 1;
  }
}

function startMusic() {
  if (!isMusicEnabled) return;
  if (!audioContext) audioContext = new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  if (musicTimer) return;
  nextNoteTime = audioContext.currentTime + 0.04;
  musicTimer = setInterval(scheduleMusic, 90);
  scheduleMusic();
}

function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

function toggleMusic() {
  isMusicEnabled = !isMusicEnabled;
  musicButton.textContent = isMusicEnabled ? "Music Off" : "Music On";
  if (isMusicEnabled && isRunning && !isPaused && !isGameOver) startMusic();
  else stopMusic();
}

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function takeFromBag() {
  if (!bag.length) bag = shuffle(Object.keys(SHAPES));
  return bag.pop();
}

function makePiece(type) {
  return {
    type,
    x: type === "O" ? 3 : 3,
    y: -1,
    rotation: 0,
    cells: SHAPES[type].map(([x, y]) => ({ x, y })),
  };
}

function rotateCells(cells, type, clockwise = true) {
  const size = type === "I" ? 4 : 3;
  if (!clockwise) return cells.map(({ x, y }) => ({ x: y, y: size - 1 - x }));
  return cells.map(({ x, y }) => ({ x: size - 1 - y, y: x }));
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

function drawCell(ctx, x, y, size, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x * size, y * size, size, size);
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(x * size + 2, y * size + 2, size - 4, 3);
  ctx.fillStyle = "rgba(0, 0, 0, 0.26)";
  ctx.fillRect(x * size + 2, y * size + size - 5, size - 4, 3);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.42)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
}

function drawGrid() {
  boardCtx.fillStyle = "#0b1012";
  boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
  boardCtx.strokeStyle = "#273237";
  boardCtx.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(x * BLOCK + 0.5, 0);
    boardCtx.lineTo(x * BLOCK + 0.5, ROWS * BLOCK);
    boardCtx.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    boardCtx.beginPath();
    boardCtx.moveTo(0, y * BLOCK + 0.5);
    boardCtx.lineTo(COLS * BLOCK, y * BLOCK + 0.5);
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

  if (current && isRunning) {
    const ghost = { ...current, y: current.y };
    while (!collides(ghost, 0, 1)) ghost.y += 1;
    pieceCells(ghost).forEach(({ x, y }) => {
      if (y >= 0) drawCell(boardCtx, x, y, BLOCK, COLORS[current.type], 0.22);
    });
    pieceCells(current).forEach(({ x, y }) => {
      if (y >= 0) drawCell(boardCtx, x, y, BLOCK, COLORS[current.type]);
    });
  }
}

function drawPreview(ctx, type) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#111719";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!type) return;

  const cells = SHAPES[type];
  const minX = Math.min(...cells.map((cell) => cell[0]));
  const maxX = Math.max(...cells.map((cell) => cell[0]));
  const minY = Math.min(...cells.map((cell) => cell[1]));
  const maxY = Math.max(...cells.map((cell) => cell[1]));
  const offsetX = Math.floor((ctx.canvas.width / PREVIEW_BLOCK - (maxX - minX + 1)) / 2) - minX;
  const offsetY = Math.floor((ctx.canvas.height / PREVIEW_BLOCK - (maxY - minY + 1)) / 2) - minY;

  cells.forEach(([x, y]) => drawCell(ctx, x + offsetX, y + offsetY, PREVIEW_BLOCK, COLORS[type]));
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
  drawPreview(nextCtx, next);
  drawPreview(holdCtx, hold);
  pauseButton.disabled = !isRunning || isGameOver;
  pauseButton.textContent = isPaused ? "Resume" : "Pause";
  startButton.textContent = isRunning && !isGameOver ? "Restart" : "Start";
}

function setOverlay(visible, title) {
  overlay.classList.toggle("is-visible", visible);
  if (title) overlayText.textContent = title;
}

function spawnPiece() {
  current = makePiece(next);
  next = takeFromBag();
  canHold = true;
  lockTimer = 0;
  if (collides(current)) endGame();
}

function mergePiece() {
  pieceCells(current).forEach(({ x, y }) => {
    if (y >= 0) board[y][x] = current.type;
  });
}

function clearLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (board[y].every(Boolean)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(null));
      cleared += 1;
      y += 1;
    }
  }

  if (cleared) {
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    score += LINE_POINTS[cleared] * level;
  }
}

function lockPiece() {
  mergePiece();
  clearLines();
  spawnPiece();
  updatePanel();
}

function move(dx) {
  if (!canAct()) return;
  if (!collides(current, dx, 0)) {
    current.x += dx;
    lockTimer = 0;
    drawBoard();
  }
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
  const kicks = current.type === "I" ? [0, -1, 1, -2, 2] : [0, -1, 1];
  const kick = kicks.find((dx) => !collides(current, dx, 0, rotated));
  if (kick !== undefined) {
    current.cells = rotated;
    current.x += kick;
    current.rotation = (current.rotation + (clockwise ? 1 : 3)) % 4;
    lockTimer = 0;
    drawBoard();
  }
}

function holdPiece() {
  if (!canAct() || !canHold) return;
  const type = current.type;
  if (hold) {
    current = makePiece(hold);
    hold = type;
  } else {
    hold = type;
    spawnPiece();
  }
  canHold = false;
  updatePanel();
  drawBoard();
}

function dropInterval() {
  return Math.max(90, 850 - (level - 1) * 68);
}

function canAct() {
  return isRunning && !isPaused && !isGameOver && current;
}

function gameLoop(time = 0) {
  const delta = time - lastTime;
  lastTime = time;

  if (isRunning && !isPaused && !isGameOver) {
    dropCounter += delta;
    if (collides(current, 0, 1)) {
      lockTimer += delta;
      if (lockTimer >= LOCK_DELAY) lockPiece();
    } else if (dropCounter >= dropInterval()) {
      current.y += 1;
      dropCounter = 0;
      lockTimer = 0;
    }
    drawBoard();
  }

  animationId = requestAnimationFrame(gameLoop);
}

function startGame() {
  board = createBoard();
  bag = [];
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
  musicStep = 0;
  next = takeFromBag();
  spawnPiece();
  setOverlay(false);
  updatePanel();
  drawBoard();
  startMusic();
}

function togglePause() {
  if (!isRunning || isGameOver) return;
  isPaused = !isPaused;
  setOverlay(isPaused, "일시정지됨");
  overlayButton.textContent = "Resume";
  if (isPaused) stopMusic();
  else startMusic();
  updatePanel();
}

function endGame() {
  isGameOver = true;
  isRunning = false;
  setOverlay(true, `게임 오버 · ${score.toLocaleString("en-US")}점`);
  overlayButton.textContent = "Restart";
  stopMusic();
  updatePanel();
}

function resetGame() {
  startGame();
}

function handleKeydown(event) {
  if (event.repeat && ["Space", "ArrowUp", "KeyX", "KeyZ", "KeyC"].includes(event.code)) return;
  const handledKeys = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp", "Space", "KeyX", "KeyZ", "KeyC", "KeyP", "Enter"];
  if (handledKeys.includes(event.code)) event.preventDefault();

  switch (event.code) {
    case "ArrowLeft":
      move(-1);
      break;
    case "ArrowRight":
      move(1);
      break;
    case "ArrowDown":
      softDrop();
      break;
    case "ArrowUp":
    case "KeyX":
      rotate(true);
      break;
    case "KeyZ":
      rotate(false);
      break;
    case "Space":
      hardDrop();
      break;
    case "KeyC":
      holdPiece();
      break;
    case "KeyP":
      togglePause();
      break;
    case "Enter":
      if (!isRunning || isGameOver) startGame();
      else if (isPaused) togglePause();
      break;
    default:
      break;
  }
}

startButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", togglePause);
resetButton.addEventListener("click", resetGame);
musicButton.addEventListener("click", toggleMusic);
overlayButton.addEventListener("click", () => {
  if (isPaused) togglePause();
  else startGame();
});
window.addEventListener("keydown", handleKeydown);
document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "left") move(-1);
    if (action === "right") move(1);
    if (action === "down") softDrop();
    if (action === "rotate") rotate(true);
    if (action === "hold") holdPiece();
    if (action === "drop") hardDrop();
  });
});

board = createBoard();
bag = [];
current = null;
next = takeFromBag();
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
isMusicEnabled = false;
nextNoteTime = 0;

updatePanel();
drawBoard();
animationId = requestAnimationFrame(gameLoop);
