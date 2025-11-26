#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

/**
 * PillowMate Action Recognition Data Logger
 *
 * Streams pressure (Velostat) + IMU readings to the serial port so a host PC
 * can capture labeled training data. Every line follows:
 *
 * millis,pressure,ax,ay,az,gx,gy,gz
 *
 * Use the accompanying python/collect_data.py script to tag each segment with
 * an interaction label (tap / rest_head / hug / shake).
 */

constexpr int kPressurePin = A0;  // Connected to Velostat + resistor divider
constexpr uint16_t kSampleDelayMs = 10;  // 100 Hz sampling; adjust as needed

Adafruit_MPU6050 imu;

void waitForSerial() {
  // Blocks until the USB CDC serial connection becomes available.
  while (!Serial) {
    delay(10);
  }
}

void printCsvHeader() {
  Serial.println(F("# millis,pressure,ax,ay,az,gx,gy,gz"));
}

void setup() {
  Serial.begin(115200);
  waitForSerial();

  pinMode(kPressurePin, INPUT);

  if (!imu.begin()) {
    Serial.println(F("ERROR: Could not find IMU (MPU6050). Check wiring."));
    while (true) {
      delay(100);
    }
  }

  // Pick gentle ranges to capture pillow interactions without clipping.
  imu.setAccelerometerRange(MPU6050_RANGE_8_G);
  imu.setGyroRange(MPU6050_RANGE_500_DEG);
  imu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  printCsvHeader();
}

void loop() {
  sensors_event_t accelEvent;
  sensors_event_t gyroEvent;
  sensors_event_t tempEvent;
  imu.getEvent(&accelEvent, &gyroEvent, &tempEvent);

  const int pressureReading = analogRead(kPressurePin);

  Serial.print(millis());
  Serial.print(',');
  Serial.print(pressureReading);
  Serial.print(',');
  Serial.print(accelEvent.acceleration.x, 4);
  Serial.print(',');
  Serial.print(accelEvent.acceleration.y, 4);
  Serial.print(',');
  Serial.print(accelEvent.acceleration.z, 4);
  Serial.print(',');
  Serial.print(gyroEvent.gyro.x, 4);
  Serial.print(',');
  Serial.print(gyroEvent.gyro.y, 4);
  Serial.print(',');
  Serial.println(gyroEvent.gyro.z, 4);

  delay(kSampleDelayMs);
}
