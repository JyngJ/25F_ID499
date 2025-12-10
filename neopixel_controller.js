import five from "johnny-five";
import pixel from "node-pixel";

const DEFAULT_PORT =
  process.env.NEOPIXEL_PORT ||
  process.env.ARDUINO_PORT ||
  process.env.BOARD_PORT ||
  null;
const DEFAULT_PIN = Number(process.env.NEOPIXEL_PIN || 6);
const DEFAULT_LENGTH = Number(process.env.NEOPIXEL_LENGTH || 8);

const RECORDING_COLOR = "#1a73ff";
const WAITING_COLOR = "#ffd200";

export const EMOTION_COLOR_MAP = {
  happy: "#ffb300",
  sad: "#1e88e5",
  angry: "#ff1744",
  frustrated: "#ff7043",
  anxious: "#ab47bc",
  stressed: "#ef5350",
  lonely: "#5e35b1",
  tired: "#90a4ae",
  excited: "#00e5ff",
  relieved: "#66bb6a",
  neutral: "#ffffff",
  uncertain: "#bdbdbd",
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
  }

  async ensureReady() {
    if (this.failed) return false;
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve) => {
      this.board = new five.Board({
        port: this.options.port || undefined,
        repl: false,
        debug: false,
        timeout: 30000,
      });

      this.board.on("ready", () => {
        this.strip = new pixel.Strip({
          board: this.board,
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
      });

      this.board.on("error", (err) => {
        console.error("Board Error:", err?.message ?? err);
        this.failed = true;
        resolve(false);
      });
    });

    return this.readyPromise;
  }

  async setSolid(color) {
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

  async showRecording() {
    return this.setSolid(RECORDING_COLOR);
  }

  async showWaiting() {
    return this.setSolid(WAITING_COLOR);
  }

  async showEmotion(emotion) {
    const color = EMOTION_COLOR_MAP[emotion] ?? EMOTION_COLOR_MAP.neutral;
    return this.setSolid(color);
  }

  async off() {
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
