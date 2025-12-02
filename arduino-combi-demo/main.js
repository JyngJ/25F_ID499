const five = require("johnny-five");
const pixel = require("node-pixel");
const keypress = require("keypress");

const MY_PORT = "/dev/tty.usbmodem1301";

const board = new five.Board({
  port: MY_PORT,
  repl: false,
  debug: false,
});

let currentPixelColor = "OFF"; // 현재 네오픽셀 색상을 추적할 변수

function updateDisplay(pressure, accel, gyro, temperature) {
  console.clear(); // 콘솔을 지우고 새로 출력하여 화면이 고정된 것처럼 보이게 함
  console.log("--------------------------------------");
  console.log(" [Current Color] ", currentPixelColor);
  console.log("--------------------------------------");
  console.log(" [Sensor Data] ");
  console.log(`  Velostat Raw    : ${pressure}`);
  console.log(`  IMU Temp        : ${temperature.celsius.toFixed(2)} °C`);
  console.log(
    `  IMU Accel (xyz) : X:${accel.x.toFixed(2)} Y:${accel.y.toFixed(2)} Z:${accel.z.toFixed(2)}`
  );
  console.log(
    `  IMU Gyro (xyz)  : X:${gyro.x.toFixed(2)} Y:${gyro.y.toFixed(2)} Z:${gyro.z.toFixed(2)}`
  );
  console.log("--------------------------------------");
  console.log("\nControl instructions:");
  console.log(" Press 'r' for RED");
  console.log(" Press 'g' for GREEN");
  console.log(" Press 'b' for BLUE");
  console.log(" Press 'w' for WHITE");
  console.log(" Press 'x' to Turn OFF");
  console.log(" Press 'Ctrl+C' to exit\n");
}

board.on("ready", function () {
  console.log("Board is ready!");
  console.log("Firmware Name: ", this.io.firmware.name);
  console.log("Firmware Version: ", this.io.firmware.version);

  // --- 1. Sensors Setup ---

  // MPU6050 IMU (I2C: A4/A5)
  const imu = new five.IMU({
    controller: "MPU6050",
    freq: 100, // 센서 업데이트 주기
  });

  // Velostat Pressure Sensor (A0)
  const pressureSensor = new five.Sensor({
    pin: "A0",
    freq: 100, // 센서 업데이트 주기
  });

  // --- 2. NeoPixel Setup ---

  // Pin 6, Length 8 (Example)
  const strip = new pixel.Strip({
    board: this,
    controller: "FIRMATA",
    strips: [{ color_order: pixel.COLOR_ORDER.GRB, pin: 6, length: 8 }],
    skip_firmware_check: true,
  });

  strip.on("ready", function () {
    console.log("NeoPixel strip is ready!");

    // Clear initially
    strip.off();
    strip.show();

    // --- 3. Monitoring Loop ---
    // 센서 데이터 주기적 출력
    // IMU 또는 압력 센서가 업데이트될 때마다 전체 디스플레이 갱신
    let lastAccel = { x: 0, y: 0, z: 0 };
    let lastGyro = { x: 0, y: 0, z: 0 };
    let lastPressure = 0;
    let lastTemperature = { celsius: 0 };

    // MPU6050 데이터 변경 시
    imu.on("change", function () {
      lastAccel = this.accelerometer;
      lastGyro = this.gyro;
      lastTemperature = this.temperature;
      updateDisplay(lastPressure, lastAccel, lastGyro, lastTemperature);
    });

    // Velostat 데이터 변경 시
    pressureSensor.on("change", function () {
      lastPressure = this.value;
      updateDisplay(lastPressure, lastAccel, lastGyro, lastTemperature);
    });

    // 최초 실행 시 한번 출력
    updateDisplay(lastPressure, lastAccel, lastGyro, lastTemperature);
  });

  // --- 4. Keypress Control ---

  keypress(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("keypress", function (ch, key) {
    if (!key) return;

    if (key.ctrl && key.name === "c") {
      process.exit();
    }

    if (!strip) return;

    switch (key.name) {
      case "r":
        currentPixelColor = "RED";
        strip.color("red");
        strip.show();
        break;
      case "g":
        currentPixelColor = "GREEN";
        strip.color("green");
        strip.show();
        break;
      case "b":
        currentPixelColor = "BLUE";
        strip.color("blue");
        strip.show();
        break;
      case "w":
        currentPixelColor = "WHITE";
        strip.color("white");
        strip.show();
        break;
      case "x":
        currentPixelColor = "OFF";
        strip.off();
        strip.show();
        break;
    }
    // 색상 변경 후 디스플레이 즉시 갱신
    updateDisplay(
      pressureSensor.value,
      imu.accelerometer,
      imu.gyro,
      imu.temperature
    );
  });
});
