# PillowMate 행동 인식 모듈 (Johnny-Five 기반)

Velostat 압력센서와 MPU6050 IMU를 이용해 PillowMate가 사용자의 물리적 상호작용(토닥, 눕기, 껴안기, 흔들기)을 분류합니다. 기존의 `*.ino` 스케치 대신, 아두이노에 **StandardFirmata**를 올려 두고 호스트 PC에서 Johnny-Five(Node.js)로 센서를 직접 제어‧수집‧추론하는 구조로 전환했습니다.

## 구성 개요

```
node/
  collect_data.js        # Johnny-Five 기반 상호작용형 데이터 수집기
  run_inference.js       # 실시간 추론 루프 (Johnny-Five + 학습된 모델)
python/
  train_model.py         # scikit-learn 로지스틱 회귀 학습 + JSON 내보내기
  requirements.txt       # Python 의존성
data/
  raw/                   # 수집된 CSV (collect_data.js 결과)
models/
  model_params.json      # train_model.py가 생성한 모델 파라미터
```

## 파이프라인 한눈에 보기

1. **데이터 수집**  
   `node/collect_data.js` → Johnny-Five가 Velostat/IMU 값을 읽고, 각 라벨(`idle`, `tap`, ...)별로 CSV를 생성합니다.
2. **모델 학습**  
   `python/train_model.py` → 모든 CSV를 병합, 표준화 및 다중 클래스 로지스틱 회귀로 학습, `models/model_params.json`으로 내보냅니다.
3. **실시간 추론**  
   `node/run_inference.js` → 동일한 센서를 읽어 최근 샘플을 평균낸 뒤 JSON 파라미터로 softmax 확률을 계산, 콘솔에 현재 동작을 표시합니다.

각 단계는 독립적으로 실행할 수 있지만, 항상 “수집 → 학습 → 추론” 순서로 진행하면 가장 최신 데이터가 반영된 모델을 얻을 수 있습니다.

## 사전 준비

1. **보드 펌웨어**  
   _Arduino IDE → File → Examples → Firmata → StandardFirmata_ 를 보드에 업로드합니다. 이 한 번의 작업 이후에는 별도 .ino 없이 PC에서 모든 처리를 수행합니다.

2. **하드웨어 연결**

   - Velostat + 저항 분압을 `A0`로 입력
   - MPU6050 IMU를 I2C(`SDA`, `SCL`)에 연결
   - USB 케이블로 PC와 연결

3. **소프트웨어**
   - Node.js 18+ (Johnny-Five 호환)
   - Python 3.9+
   - 루트에서 `npm install` 을 실행하여 `johnny-five`, `commander` 등 의존성을 설치합니다.
   - `cd ActionRecognitionModule/python && conda create -n pillowmate-action python=3.10 -y && conda activate pillowmate-action && pip install -r requirements.txt`

## 1. 데이터 수집 (`node/collect_data.js`)

**Serial 포트 지정 (선택)**

1. 보드를 USB에 연결한 뒤 리눅스에서 포트를 확인합니다.
   ```bash
   ls /dev/ttyACM*
   # 또는
   ls /dev/ttyUSB*
   # 상세 확인: dmesg | grep tty
   ```
2. 확인한 경로를 `ActionRecognitionModule/.env` 파일에 작성합니다.
   ```
   SERIAL_PORT=/dev/ttyACM0
   ```
   Node 기반 도구(`node/collect_data.js`, `node/run_inference.js`)가 자동으로 이 값을 사용해 특정 포트로 연결을 시도합니다.

```bash
cd ActionRecognitionModule
node node/collect_data.js \
  --labels idle tap rest_head hug \
  --duration 6 \
  --trials 3
```

- 실행하면 각 라벨마다 `Enter` 키를 눌러 녹음을 시작하도록 안내합니다.
- 스크립트가 먼저 압력센서 기준치를 자동으로 측정한 뒤, `data/raw/action_module_YYYYMMDD_HHMMSS.csv`에 `pressure`(baseline 제거값) + IMU + 라벨을 기록합니다.
- 주요 옵션
  - `--labels <labels...>`: 기록 대상 라벨 목록. 기본값은 `idle tap rest_head hug shake`.
  - `--duration <seconds>`: 한 trial 동안 저장할 시간(초). 기본 5초.
  - `--trials <count>`: 라벨당 반복 횟수. 기본 3회.
  - `--sample-ms <ms>`: 센서를 몇 ms마다 샘플링할지(기본 20ms). 값이 작을수록 샘플이 많아집니다.
  - `--pressure-pin <pin>`: Velostat를 연결한 아날로그 핀(`A0` 등).
  - `--imu-controller <name>`: Johnny-Five IMU 컨트롤러 이름(기본 `MPU6050`). 다른 센서를 쓰면 변경하세요.
  - `--baseline-samples <count>`: baseline 측정에 사용할 샘플 수. 기본 200.
  - `--output <dir>`: CSV를 저장할 디렉터리. 기본 `ActionRecognitionModule/data/raw`.
  - `--quiet`: 실행 중 콘솔에 센서 값을 출력하지 않도록 함.
- 환경 변수
  - `SERIAL_PORT` (또는 `.env`에 동일한 키 작성): 보드가 연결된 시리얼 포트를 강제로 지정하고 싶을 때 사용합니다. 예: `SERIAL_PORT=/dev/tty.usbmodem1101`.
- `idle` 라벨은 베개를 건드리지 않고 자연스럽게 놓여 있는 상태를 의미합니다. 데이터 수집 시 가장 먼저 녹화하면 모델이 기본 자세를 안정적으로 분리할 수 있습니다.

## 2. 모델 학습 (`python/train_model.py`)

```bash
cd ActionRecognitionModule/python
python train_model.py
```

- `data/raw/*.csv` 를 모두 읽어 표준화 + 다중 클래스 로지스틱 회귀를 학습합니다.
- 출력
  - `models/model_params.json`: Johnny-Five 추론 루프가 직접 읽을 수 있는 가중치/편향/스케일 정보
  - 콘솔 분류 리포트 + 혼동 행렬
- 주요 옵션
  - `--data-dir <path>`: CSV를 모아 둔 경로. 기본 `../data/raw`.
  - `--json-out <path>`: 학습 결과를 기록할 JSON 경로. 기본 `../models/model_params.json`.
  - `--test-size <ratio>`: 검증 세트 비율(0~1). 기본 0.2.
  - `--random-state <seed>`: train/test 분할과 모델 초기화 시드. 기본 42.

## 3. 실시간 추론 (`node/run_inference.js`)

```bash
cd ActionRecognitionModule
node node/run_inference.js \
  --model models/model_params.json \
  --window-size 8 \
  --prediction-interval 250 \
  --idle-label idle
```

- 실행 시 압력 기준을 다시 측정하고, 지정된 윈도우 길이만큼 센서를 평균낸 뒤 확률이 가장 높은 라벨과 신뢰도를 콘솔에 출력합니다. 화면 하단에는 `현재 동작` 상태가 실시간으로 업데이트되며, 라벨이 바뀔 때마다 타임스탬프 로그가 추가됩니다.
- 주요 옵션
  - `--model <path>`: 사용할 `model_params.json` 위치.
  - `--pressure-pin <pin>` / `--imu-controller <name>` / `--sample-ms <ms>`: 수집 스크립트와 동일한 의미.
  - `--window-size <samples>`: 평균에 사용할 샘플 개수. 8이면 약 160ms 분량.
  - `--prediction-interval <ms>`: 예측/상태 갱신 주기. 기본 250ms.
  - `--baseline-samples <count>`: 실행 시 재측정할 baseline 샘플 수. 기본 200.
  - `--min-prob <value>`: 이 확률 이상일 때만 동작 라벨로 인정. 낮출수록 민감해짐.
  - `--idle-label <name>`: 모델에서 “가만히 있는 상태”로 간주할 라벨. 기본 `idle`.
  - `--verbose`: 각 예측마다 평균 피처 벡터를 추가 출력.
  - 환경 변수 `SERIAL_PORT`: 특정 포트로 강제 연결할 때 사용 (collect_data와 동일).

## 작동 방식

- **피처**: `[pressure_delta, ax, ay, az, gx, gy, gz]` (pressure_delta는 수집/추론 시 동일하게 baseline을 뺀 값)
- **모델**: z-score 표준화 후 다중 클래스 로지스틱 회귀 (`scikit-learn`).
- **추론 루프**: Johnny-Five로 센서를 50Hz 전후로 샘플링 → 최근 `N`개의 샘플을 평균 → JSON 파라미터로 logits 계산 → softmax 확률.

## 유용한 옵션/확장

- 라벨 수를 늘리거나 줄이고 싶다면 `collect_data.js --labels ...` 에서 원하는 목록을 전달하고 동일한 목록으로 데이터를 수집한 뒤 재학습합니다.
- 기본 상태를 더 잘 모델링하려면 `idle`(또는 원하는 이름) 라벨을 충분히 녹화하고, 추론 시 `--idle-label` 옵션으로 동일한 이름을 지정합니다.
- 다른 IMU를 쓴다면 `run_inference.js --imu-controller` 와 `collect_data.js --imu-controller` 를 해당 Johnny-Five 컨트롤러 이름으로 바꾸면 됩니다.
- 데이터 품질을 높이고 싶다면 `data/raw`의 여러 CSV를 수동으로 정제해도 괜찮습니다. `train_model.py`는 지정된 디렉터리의 모든 CSV를 자동으로 병합합니다.

## 문제 해결

- **보드 연결 오류**: StandardFirmata가 올라가 있는지, 다른 프로세스가 시리얼 포트를 잡고 있지 않은지 확인합니다.
- **센서 값이 0만 나오는 경우**: 전원/그라운드/아날로그 핀 결선을 재확인하고 `collect_data.js --pressure-pin` 값이 맞는지 검증하세요.
- **예측이 한 라벨에만 치우칠 때**: 라벨별 데이터 균형을 맞추고, `models/model_params.json`을 최신 데이터로 재생성합니다.
- **npm 의존성**: `node`/`npm`이 설치되어 있지 않은 환경이라면 설치 후 `npm install`을 다시 실행해야 합니다.

이제 별도의 .ino 수정 없이도 USB로 연결된 보드에서 바로 데이터를 모으고, 학습하고, 실시간으로 예측까지 수행할 수 있습니다. 즐거운 실험 되세요!
