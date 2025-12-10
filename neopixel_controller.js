import five from "johnny-five";
import pixel from "node-pixel";

const DEFAULT_PORT =
  process.env.SERIAL_PORT ||
  process.env.NEOPIXEL_PORT ||
  process.env.ARDUINO_PORT ||
  process.env.BOARD_PORT ||
  null;
const DEFAULT_PIN = Number(process.env.NEOPIXEL_PIN || 6);
const DEFAULT_LENGTH = 44;

// Define patterns mapping: color + pattern type + optional interval
export const EMOTION_PATTERN_MAP = {
  // System states
  listening: { color: "#ffd200", pattern: "breathe", interval: 20 },
  recording: { color: "#1a73ff", pattern: "blink", interval: 500 },
  processing: { color: "#00e5ff", pattern: "colorWipe", interval: 50 },
  
  // Emotions
  happy: { color: "#ffb300", pattern: "breathe", interval: 30 },
  sad: { color: "#1e88e5", pattern: "breathe", interval: 40 },
  angry: { color: "#ff1744", pattern: "blink", interval: 200 },
  frustrated: { color: "#ff7043", pattern: "solid" },
  anxious: { color: "#ab47bc", pattern: "blink", interval: 300 },
  stressed: { color: "#ef5350", pattern: "breathe", interval: 20 },
  lonely: { color: "#5e35b1", pattern: "breathe", interval: 50 },
  tired: { color: "#90a4ae", pattern: "solid" },
  excited: { color: "#00e5ff", pattern: "blink", interval: 150 },
  relieved: { color: "#66bb6a", pattern: "breathe", interval: 35 },
  neutral: { color: "#ffffff", pattern: "solid" },
  uncertain: { color: "#bdbdbd", pattern: "breathe", interval: 40 },
};

class NeoPixelController {
  constructor(options = {}) {
    this.options = {
      port: DEFAULT_PORT,
      pin: DEFAULT_PIN,
      length: DEFAULT_LENGTH,
      colorOrder: pixel.COLOR_ORDER.GRB,
      ...options,
    };
    this.board = null;
    this.strip = null;
    this.readyPromise = null;
    this.failed = false;
    this.currentColor = "off";
    this.currentPatternInterval = null;
  }

  setBoard(board) {
    this.options.board = board;
    // Reset ready promise so ensureReady will re-init with the shared board.
    this.readyPromise = null;
    this.failed = false;
    this.strip = null;
  }

  async ensureReady() {
    if (this.failed) return false;
    if (this.readyPromise) return this.readyPromise;

    const initStrip = (board, resolve) => {
      this.strip = new pixel.Strip({
        board,
        controller: "FIRMATA",
        strips: [
          {
            color_order: this.options.colorOrder,
            pin: this.options.pin,
            length: this.options.length,
          },
        ],
        skip_firmware_check: true,
      });

      this.strip.on("ready", () => {
        this.strip.off();
        this.strip.show();
        this.currentColor = "off";
        resolve(true);
      });

      this.strip.on("error", (err) => {
        console.error("NeoPixel strip error:", err?.message ?? err);
        this.failed = true;
        resolve(false);
      });
    };

    this.readyPromise = new Promise((resolve) => {
      const externalBoard = this.options.board;
      if (externalBoard) {
        this.board = externalBoard;
        const onReady = () => initStrip(externalBoard, resolve);
        if (externalBoard.isReady) {
          onReady();
        } else {
          externalBoard.once("ready", onReady);
          externalBoard.once("error", (err) => {
            console.error("Board Error:", err?.message ?? err);
            this.failed = true;
            resolve(false);
          });
        }
        return;
      }

      this.board = new five.Board({
        port: this.options.port || undefined,
        repl: false,
        debug: false,
        timeout: 30000,
      });

      this.board.on("ready", () => initStrip(this.board, resolve));

      this.board.on("error", (err) => {
        console.error("Board Error:", err?.message ?? err);
        this.failed = true;
        resolve(false);
      });
    });

    return this.readyPromise;
  }

  stopCurrentPattern() {
    if (this.currentPatternInterval) {
      clearInterval(this.currentPatternInterval);
      this.currentPatternInterval = null;
    }
  }

  async setSolid(color) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;
    try {
      this.strip.color(color);
      this.strip.show();
      this.currentColor = color;
      return true;
    } catch (err) {
      console.error("Failed to set NeoPixel color:", err?.message ?? err);
      return false;
    }
  }

  async blink(color, intervalMs = 500) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;

    let isOn = false;
    this.currentPatternInterval = setInterval(() => {
      if (isOn) {
        this.strip.off();
      } else {
        this.strip.color(color);
      }
      this.strip.show();
      isOn = !isOn;
    }, intervalMs);
    return true;
  }

  async colorWipe(color, intervalMs = 50) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;

    let i = 0;
    this.strip.off();
    this.strip.show();

    this.currentPatternInterval = setInterval(() => {
      if (i >= this.strip.length) {
        i = 0;
        this.strip.off();
      }

      this.strip.pixel(i).color(color);
      this.strip.show();
      i++;
    }, intervalMs);
    return true;
  }

  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : { r: 0, g: 0, b: 0 };
  }

  async breathe(color, intervalMs = 20) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;

    const rgb = this._hexToRgb(color);
    let tick = 0;

    this.currentPatternInterval = setInterval(() => {
      // Create a smooth sine wave for brightness (0.05 to 1.0)
      const brightness = (Math.sin(tick) + 1) / 2 * 0.95 + 0.05;

      const r = Math.floor(rgb.r * brightness);
      const g = Math.floor(rgb.g * brightness);
      const b = Math.floor(rgb.b * brightness);

      const currentHex = `rgb(${r}, ${g}, ${b})`;

      this.strip.color(currentHex);
      this.strip.show();

      tick += 0.1;
    }, intervalMs);
    return true;
  }

  // 서서히 켜지기
  async fadeIn(color, durationMs = 1000) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;

    const rgb = this._hexToRgb(color);
    const steps = 50; // 단계 수
    const interval = durationMs / steps;
    let step = 0;

    this.currentPatternInterval = setInterval(() => {
      step++;
      const brightness = step / steps; // 선형 증가 (0 -> 1)
      
      const r = Math.floor(rgb.r * brightness);
      const g = Math.floor(rgb.g * brightness);
      const b = Math.floor(rgb.b * brightness);
      
      this.strip.color(`rgb(${r}, ${g}, ${b})`);
      this.strip.show();

      if (step >= steps) {
        clearInterval(this.currentPatternInterval);
        this.currentPatternInterval = null;
        this.currentColor = color; // 최종 상태 저장
      }
    }, interval);
    
    return true;
  }

  // 서서히 꺼지기
  async fadeOut(durationMs = 1000) {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;

    // 현재 색상을 알 수 없다면 마지막 저장된 색상 사용, 없으면 흰색 가정
    // (node-pixel에서 현재 색상을 읽어오는 건 복잡할 수 있으므로 this.currentColor 활용)
    const startColor = (this.currentColor && this.currentColor !== 'off') ? this.currentColor : '#ffffff';
    const rgb = this._hexToRgb(startColor);

    const steps = 50;
    const interval = durationMs / steps;
    let step = steps;

    this.currentPatternInterval = setInterval(() => {
      step--;
      const brightness = step / steps; // 선형 감소 (1 -> 0)

      const r = Math.floor(rgb.r * brightness);
      const g = Math.floor(rgb.g * brightness);
      const b = Math.floor(rgb.b * brightness);

      this.strip.color(`rgb(${r}, ${g}, ${b})`);
      this.strip.show();

      if (step <= 0) {
        clearInterval(this.currentPatternInterval);
        this.currentPatternInterval = null;
        this.strip.off();
        this.strip.show();
        this.currentColor = 'off';
      }
    }, interval);

    return true;
  }

  async showRecording() {
    return this.showEmotion("recording");
  }

  async showWaiting() {
    return this.showEmotion("listening");
  }

  async showEmotion(emotion) {
    const config = EMOTION_PATTERN_MAP[emotion] ?? EMOTION_PATTERN_MAP.neutral;
    const { color, pattern, interval } = config;

    switch (pattern) {
      case "blink":
        return this.blink(color, interval);
      case "breathe":
        return this.breathe(color, interval);
      case "colorWipe":
        return this.colorWipe(color, interval);
      case "fadeIn":
        return this.fadeIn(color, interval);
      case "fadeOut":
        return this.fadeOut(interval);
      case "solid":
      default:
        return this.setSolid(color);
    }
  }

  async off() {
    this.stopCurrentPattern();
    const ready = await this.ensureReady();
    if (!ready || !this.strip) return false;
    try {
      this.strip.off();
      this.strip.show();
      this.currentColor = "off";
      return true;
    } catch (err) {
      console.error("Failed to clear NeoPixel strip:", err?.message ?? err);
      return false;
    }
  }
}

export const neoPixel = new NeoPixelController();
