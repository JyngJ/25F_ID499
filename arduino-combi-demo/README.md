# Arduino Combi Demo (IMU + Velostat + NeoPixel)

이 프로젝트는 **MPU6050(IMU)**, **Velostat(압력센서)**, 그리고 **NeoPixel(LED)**을 동시에 제어하고 모니터링하기 위한 Node.js 데모입니다.

특히 **Johnny-Five** 환경에서 네오픽셀을 제어하기 위해 **커스텀 Firmata**를 사용하는 방법을 다룹니다.

## 🔌 하드웨어 연결

| 부품 | 아두이노 핀 | 비고 |
| --- | --- | --- |
| **MPU6050** (IMU) | **SDA (A4)**, **SCL (A5)** | I2C 통신 |
| **Velostat** (압력) | **A0** | Analog Input (저항 분배 회로 필요) |
| **NeoPixel** (LED) | **Digital 6** | PWM 아님, 데이터 핀 |

---

## 🚀 빠른 시작 (Quick Start)

### 1. 의존성 설치
```bash
cd arduino-combi-demo
npm install
```
*참고: 호환성 문제로 `serialport` v9 버전을 사용합니다.*

### 2. 실행
```bash
node main.js
```
*   **센서 데이터:** 화면에 IMU와 압력 값이 실시간으로 표시됩니다.
*   **키보드 제어:**
    *   `r`: 빨강 (Red)
    *   `g`: 초록 (Green)
    *   `b`: 파랑 (Blue)
    *   `w`: 흰색 (White)
    *   `x`: 끄기 (OFF)
    *   `Ctrl + C`: 종료

---

## 🛠️ 펌웨어 설치 가이드 (가장 중요!)

이 프로젝트는 일반 `StandardFirmata`로는 작동하지 않습니다. **네오픽셀 제어 기능이 포함된 커스텀 펌웨어**를 아두이노에 올려야 합니다.

가장 확실하고 에러 없는 방법은 **Arduino IDE**를 사용하는 것입니다.

### 단계별 설치법

1.  **Arduino IDE**를 실행합니다.
2.  **파일 열기**: 아래 경로의 파일을 엽니다.
    *   경로: `arduino-combi-demo/custom_firmware/custom_firmware.ino`
3.  **업로드**:
    *   보드: **Arduino Uno**
    *   포트: 연결된 포트 선택
    *   화살표 버튼(➡️)을 눌러 업로드합니다.
4.  끝! 이제 `node main.js`를 실행하면 됩니다.

> **왜 이렇게 하나요?**
> `node-pixel` 라이브러리는 전용 펌웨어를 요구합니다. 자동 설치 도구(`interchange`)가 가끔 멈추는 문제가 있어, 확실한 수동 업로드를 권장합니다.

---

## ⚠️ 트러블슈팅

### 1. "Timeout occurred while connecting to the Board"
*   **원인:** 아두이노가 이전 연결 상태에 있거나 포트 응답이 늦을 때 발생합니다.
*   **해결:**
    1.  아두이노의 **리셋(RESET) 버튼**을 누르거나, USB를 뽑았다가 다시 꽂으세요.
    2.  약 5초 후 다시 실행해 보세요.

### 2. "IncorrectFirmataVersionError"
*   **원인:** 펌웨어 이름이 라이브러리가 기대하는 이름(`node_pixel_firmata.ino`)과 다를 때 발생합니다.
*   **해결:** `main.js` 코드 내에 `skip_firmware_check: true` 옵션이 켜져 있는지 확인하세요. (현재 코드는 이미 적용되어 있습니다.)

### 3. 포트 못 찾음
*   **해결:** `main.js` 상단의 `MY_PORT` 변수를 본인의 포트 주소(예: `/dev/tty.usbmodem...`)로 수정하세요. 확인 명령어: `ls /dev/tty.usbmodem*`
