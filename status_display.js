const STATUS_WIDTH = 140;
const RENDER_INTERVAL_MS = 50;

let voicePart = "🎧 음성 대기";
let sensorPart = "🧭 센서 대기";
let renderPending = false;
let lastRender = 0;
let initialized = false;
let statusLineSaved = false;
let lastOut = "";

function pad(text) {
  const str = text ?? "";
  if (str.length >= STATUS_WIDTH) return str.slice(0, STATUS_WIDTH);
  return str.padEnd(STATUS_WIDTH, " ");
}

function scheduleRender() {
  const now = Date.now();
  if (renderPending || now - lastRender < RENDER_INTERVAL_MS) return;
  renderPending = true;
  setImmediate(() => {
    renderPending = false;
    render();
  });
}

function render() {
  lastRender = Date.now();
  const out = pad(`${voicePart} | ${sensorPart}`);
  if (out === lastOut) return;
  lastOut = out;

  // 최초에 상태 줄을 하나 만들어 위치를 저장
  if (!initialized) {
    process.stdout.write("\n");
    process.stdout.write("\x1b[s"); // 상태 줄 위치 저장
    statusLineSaved = true;
    initialized = true;
  }
  if (!statusLineSaved) return;

  // 현재 커서 위치 저장 → 상태 줄 위치로 이동 → 덮어쓰기 → 이전 커서 복원
  process.stdout.write("\x1b7"); // save cursor
  process.stdout.write("\x1b[u"); // jump to status line
  process.stdout.write(`\r\x1b[2K${out}`);
  process.stdout.write("\x1b8"); // restore cursor
}

export function attachStatusDisplay() {
  scheduleRender();
}

export function updateMicDisplay(text) {
  const next = text ?? "";
  if (next !== voicePart) {
    voicePart = next;
    scheduleRender();
  }
}

export function updateSensorDisplay(text) {
  const next = text ?? "";
  if (next !== sensorPart) {
    sensorPart = next;
    scheduleRender();
  }
}
