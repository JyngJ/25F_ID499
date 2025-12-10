const five = require("johnny-five");
const pixel = require("node-pixel");
const keypress = require("keypress");

const MY_PORT = process.env.SERIAL_PORT ||
  process.env.NEOPIXEL_PORT ||
  process.env.ARDUINO_PORT ||
  process.env.BOARD_PORT ||
  null;

const board = new five.Board({
  port: MY_PORT,
  repl: false,
  debug: false,
  timeout: 30000 // 타임아웃을 30초로 늘림 (기본값 10초)
});

// 에러 핸들러 추가 (프로그램 멈춤 방지)
board.on("error", function(err) {
  console.log("Board Error: ", err.message);
});

let currentPixelColor = "OFF"; // 현재 네오픽셀 색상을 추적할 변수

// 센서 값 저장용 변수
let lastAccel = {x:0,y:0,z:0};
let lastGyro = {x:0,y:0,z:0};
let lastPressure = 0;
let lastTemperature = {celsius:0};


function updateDisplay() {
  console.clear(); // 콘솔을 지우고 새로 출력하여 화면이 고정된 것처럼 보이게 함
  console.log("--------------------------------------");
  console.log(" [Current Color] ", currentPixelColor);
  console.log("--------------------------------------");
  console.log(" [Sensor Data] ");
  console.log(`  Velostat Raw    : ${lastPressure}`);
  console.log(`  IMU Temp        : ${lastTemperature.celsius.toFixed(2)} °C`);
  console.log(`  IMU Accel (xyz) : X:${lastAccel.x.toFixed(2)} Y:${lastAccel.y.toFixed(2)} Z:${lastAccel.z.toFixed(2)}`);
  console.log(`  IMU Gyro (xyz)  : X:${lastGyro.x.toFixed(2)} Y:${lastGyro.y.toFixed(2)} Z:${lastGyro.z.toFixed(2)}`);
  console.log("--------------------------------------");
  console.log("\nControl instructions:");
  console.log(" Press 'r' for RED");
  console.log(" Press 'g' for GREEN");
  console.log(" Press 'b' for BLUE");
  console.log(" Press 'w' for WHITE");
  console.log(" Press 'x' to Turn OFF");
  console.log(" Press 'Ctrl+C' to exit\n");
}


board.on("ready", function() {
  console.log("Board is ready!");
  console.log("Firmware Name: ", this.io.firmware.name);
  console.log("Firmware Version: ", this.io.firmware.version);

  // --- 1. Sensors Setup ---
  
  // MPU6050 IMU (I2C: A4/A5)
  const imu = new five.IMU({
    controller: "MPU6050",
    freq: 100 // 센서 업데이트 주기
  });

  // Velostat Pressure Sensor (A0)
  const pressureSensor = new five.Sensor({
    pin: "A0",
    freq: 100 // 센서 업데이트 주기
  });

  // --- 2. NeoPixel Setup ---
  
  // Pin 6, Length 8 (Example)
  const strip = new pixel.Strip({
    board: this,
    controller: "FIRMATA",
    strips: [ {color_order: pixel.COLOR_ORDER.GRB, pin: 6, length: 44} ],
    skip_firmware_check: true
  });

  strip.on("ready", function() {
    console.log("NeoPixel strip is ready!");
    
    // Clear initially
    strip.off();
    strip.show();
    
    // --- 3. Monitoring Loop ---
    // 센서 데이터는 빠르게 업데이트, 디스플레이는 주기적으로 갱신
    
    // MPU6050 데이터 변경 시: 변수만 업데이트
    imu.on("change", function() {
      lastAccel = this.accelerometer;
      lastGyro = this.gyro;
      lastTemperature = this.temperature;
    });

    // Velostat 데이터 변경 시: 변수만 업데이트
    pressureSensor.on("change", function() {
      lastPressure = this.value;
    });

    // 디스플레이 갱신은 별도의 타이머로 관리 (콘솔 깜빡임 방지)
    setInterval(updateDisplay, 200); // 200ms마다 한 번씩 화면 갱신 (조정 가능)

    // 최초 실행 시 한번 출력 (setInterval이 바로 호출되므로 주석 처리)
    // updateDisplay(); 
  });

  // --- 4. Keypress Control ---
  
  keypress(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  process.stdin.on("keypress", function(ch, key) {
    if (!key) return;

    if (key.ctrl && key.name === "c") {
      process.exit();
    }

    if (!strip) return;

    switch (key.name) {
      case 'r':
        currentPixelColor = "RED";
        strip.color("red");
        strip.show();
        break;
      case 'g':
        currentPixelColor = "GREEN";
        strip.color("green");
        strip.show();
        break;
      case 'b':
        currentPixelColor = "BLUE";
        strip.color("blue");
        strip.show();
        break;
      case 'w':
        currentPixelColor = "WHITE";
        strip.color("white");
        strip.show();
        break;
      case 'x':
        currentPixelColor = "OFF";
        strip.off();
        strip.show();
        break;
    }
    // 색상 변경 후 디스플레이 즉시 갱신
    updateDisplay(); // 센서 값은 최신 변수들을 참조합니다.
  });
});
