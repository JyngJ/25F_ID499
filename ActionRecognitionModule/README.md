# PillowMate 시퀀스 기반 행동 인식 파이프라인

이 프로젝트는 음성 턴 길이에 맞춰 **가변 길이** 센서 시퀀스를 그대로 학습‧추론할 수 있도록 만든 파이프라인입니다. 기존 고정 윈도우 로지스틱 회귀 코드를 수정하지 않고, 새로운 데이터 흐름과 모델(양방향 GRU)을 제공합니다.

## 구성

```
node/
  collect_sequences.js      # 라벨별 가변 길이 시퀀스 수집
  run_sequence_inference.js # 사용자 턴 단위 실시간 추론
python/
  train_sequence_model.py   # PyTorch GRU 학습
  sequence_model.py         # 모델 정의
  sequence_infer.py         # 단일 시퀀스 추론 CLI
data/
  raw/                      # JSON 시퀀스 저장 위치
models/
  sequence_classifier.pt    # GRU 가중치
  sequence_config.json      # 라벨/정규화/모델 메타데이터
```

## 0. 의존성

- Node.js 18+ (`johnny-five`, `commander`, etc.) – 루트에서 `npm install` 한 번이면 됩니다.
- Python 3.10+ + PyTorch 2.x (CPU로 충분). 예:
  ```bash
  pip install torch==2.3.1 --extra-index-url https://download.pytorch.org/whl/cpu
  pip install numpy scikit-learn
  ```

## 1. 가변 길이 시퀀스 수집

```bash
cd ActionRecognitionModule
node node/collect_sequences.js \
  --labels hug shake rest_head tap \
  --trials 5 \
  --sample-ms 20 \
  --record-seconds 30 \
  --output data/raw/251209pillowmate_full
```

- `Enter`로 녹화를 시작하면 지정된 시간(`--record-seconds`, 기본 30초) 동안 자동으로 기록하고 종료합니다. 0을 주면 이전처럼 수동 종료 모드가 됩니다.
- `--output`을 바꿔 세션별 디렉터리(예: `data/raw/session_YYYYMMDD`)를 만들면, 나중에 학습 시 여러 세션을 동시에 지정할 수 있습니다.
- 주요 옵션
  - `--labels <...>`: 녹화할 라벨 목록 (기본 `idle hug shake rest_head tap`)
  - `--trials <count>`: 라벨당 반복 횟수
  - `--sample-ms <ms>`: Johnny-Five 샘플링 주기
  - `--pressure-pin`, `--imu-controller`: 센서 핀과 IMU 종류
  - `--baseline-samples`: ΔP 계산을 위한 기준 샘플 수
  - `--record-seconds <sec>`: 라벨별 자동 녹화 길이. 0이면 수동 종료 모드.
  - `--output <dir>`: JSON 시퀀스를 저장할 경로 (기본 `data/raw`)
  - `--quiet`: 중간 샘플 로그를 숨김
  - `--port <path>` 또는 `.env`의 `SERIAL_PORT`: 특정 시리얼 포스 강제
- 출력 JSON 예시
  ```json
  {
    "label": "hug",
    "sample_ms": 20,
    "feature_names": ["pressure_delta","ax","ay","az","gx","gy","gz"],
    "features": [[-12.3, 0.01, ...], ...]
  }
  ```

## 2. 데이터 증강 (선택)

고정 길이로 수집된 시퀀스를 다양한 길이/강도로 변형해 모델 일반화를 높입니다.

```bash
cd ActionRecognitionModule/python
python augment_sequences.py \
  --data-dir ../data/raw/251209pillowmate_full_many \
  --output-dir ../data/augmented \
  --ops random_crop time_scale time_shift amplitude_scale \
  --copies 15 \
  --include-original \
  --split-by-session \
  --time-shift-ratio 0.2 \
  --amplitude-scale-min 0.8 \
  --amplitude-scale-max 1.2 \
```

- `--ops`: 적용할 증강 목록. 각 기법의 의미/세부 옵션:
  - `random_crop`: 긴 시퀀스를 임의 구간으로 잘라 짧은 행동처럼 만듭니다 (`--min-crop-ratio`, `--max-crop-ratio`).
  - `time_scale`: `--min-scale`~`--max-scale` 범위로 시간을 압축하거나 늘립니다.
  - `time_shift`: 전체 시퀀스를 `--time-shift-ratio` 비율만큼 앞뒤로 이동하여 시작 위치를 바꿉니다.
  - `amplitude_scale`: 각 특징을 `--amplitude-scale-min`~`--amplitude-scale-max` 비율로 스케일링해 강도를 변형합니다.
  - `time_mask`: `--time-mask-ratio`만큼의 프레임을 0으로 만들고, `--time-mask-chunks`개 구간을 마스킹하여 누락/정지 구간을 흉내 냅니다. `--time-mask-targets`로 어떤 특징(pressure/accelerometer/gyroscope/all)에 적용할지 선택할 수 있으며, 기본은 pressure만 0으로 설정합니다.
  - `noise`: `--noise-std` 표준편차의 가우시안 노이즈를 추가합니다(필요하면 `--ops` 목록에 `noise` 추가).
- `--data-dir`를 여러 개 전달해 새로 수집한 폴더들을 한 번에 증강할 수 있습니다.
- `--split-by-session`을 켜면 `data/augmented/<세션명>/...` 형태로 저장되어 세션별 디렉터리가 유지됩니다.
- 추가 하이퍼파라미터
  - `--copies`: 원본 1개당 몇 개의 증강본을 만들지.
  - `--min/max-crop-ratio`, `--min/max-scale`: 크롭/시간 스케일 범위.
  - `--time-shift-ratio`, `--amplitude-scale-min|max`, `--time-mask-ratio`, `--time-mask-chunks`, `--time-mask-targets`, `--noise-std` 등을 상황에 맞게 조절하세요.
  - Idle 데이터에는 crop/shift를 제외하고, tap/hug에만 적용하고 싶다면 명령을 나눠 실행해도 됩니다.

증강 결과는 `data/augmented/*.json`으로 저장됩니다.

## 3. GRU 모델 학습

```bash
cd ActionRecognitionModule/python
python train_sequence_model.py \
  --data-dir ../data/augmented/251209pillowmate_full_many \
  --model-out ../models/251209pillowmate_full_many.pt \
  --config-out ../models/251209pillowmate_full_many.json \
  --epochs 100 \
  --val-split 0.30 \
  --batch-size 32 \
  --hidden-dim 128 \
  --low-pass-window 5 \
  --stop-when-val-acc 0.99 \
  --stop-patience 4 \
  --log-misclassifications \
  --device cpu \
  --exclude-labels idle
```

- `--data-dir` 옵션은 여러 개를 연속으로 지정할 수 있습니다. 예: `--data-dir ../data/raw/session_A ../data/raw/session_B`.
- 지정한 디렉터리들의 모든 시퀀스를 합쳐 한 번에 학습합니다. 증강 데이터를 쓰고 싶다면 증강 출력 디렉터리를 포함시키면 됩니다.
- 주요 옵션
  - `--val-split`: 검증 비율 (기본 0.2). 검증 샘플을 늘리고 싶다면 0.3~0.4로 조정하세요.
  - `--random-state`: 시드
  - `--device`: `cpu`, `cuda`, `auto`. Apple Silicon(M1/M2)에서 Metal 가속을 쓰려면 PyTorch(MPS 지원)를 설치하고 `--device mps`를 명시하세요.
  - `--low-pass-window`: 모든 시퀀스에 이동 평균 필터를 적용해 고주파 노이즈를 줄입니다(기본 1 = 미적용).
  - `--exclude-labels`: 특정 라벨을 완전히 제외하고 학습하고 싶을 때 사용합니다. 예: `--exclude-labels idle`.
  - `--stop-when-val-acc`: 검증 정확도가 특정 값(0~1)에 도달하면 조기 종료합니다. 검증 세트가 있어야 작동합니다.
  - `--stop-patience`: 위 정확도 조건을 연속 몇 번 만족해야 멈출지(기본 1회). 예: `--stop-when-val-acc 0.98 --stop-patience 3`.
  - `--log-misclassifications`: 각 epoch의 검증 단계에서 어떤 라벨이 어떤 라벨로 잘못 분류됐는지 요약을 출력합니다.
  - 학습 중 검증 정확도가 갱신될 때마다 즉시 체크포인트를 저장하며, 동일 정확도일 경우 최신 상태로 덮어씁니다.
- 출력물
  - `sequence_classifier.pt`: PyTorch state dict
  - `sequence_config.json`: 라벨 목록, 정규화(mean/std), 모델 하이퍼파라미터
- 학습 로그에는 Epoch별 train/val loss 및 정확도가 표시됩니다.

## 4. 사용자 턴 추론

### 3.1 Node + Python 연동 (실제 센서)

```bash
cd ActionRecognitionModule
node node/run_sequence_inference.js \
  --model models/251209pillowmate_full.pt \
  --config models/251209pillowmate_full.json \
  --low-pass-window 5 \
  --auto-idle \
  --idle-label idle \
  --idle-pressure-std 20 \
  --idle-pressure-mean 40 \
  --idle-accel-std 0.1 \
  --idle-gyro-std 5 \
  --python-device mps
```

- Enter → 녹화 시작, 행동 수행 → Enter → Python 추론 실행 → 결과 출력.
- 여러 턴을 반복해서 실행하며, 매번 `sequence_infer.py`를 통해 라벨과 확률이 JSON으로 반환됩니다.

주요 옵션

- `--python`: 사용할 Python 명령 (기본 `python3`)
- `--infer-script`: `sequence_infer.py` 위치
- `--pressure-pin`, `--imu-controller`, `--sample-ms`, `--baseline-samples`: 수집과 동일
- `--quiet`: 중간 샘플 로그 숨김
- `--port`/`SERIAL_PORT`: 시리얼 포트 강제
- `--low-pass-window`: 추론 전 이동 평균 필터 길이. 학습 시 사용한 값과 맞추면 동일한 전처리가 됩니다.
- `--python-device`: `sequence_infer.py`에 전달할 PyTorch 디바이스(`mps`, `cpu`, `cuda`). M1/M2에서는 기본 `mps`로 빠르게 추론할 수 있습니다.
- `--auto-idle`: 활성화하면 압력/IMU 변동이 매우 작거나 평균 압력 델타가 거의 0에 가까울 때 분류기에 돌리지 않고 지정한 라벨(`--idle-label`, 기본 idle)을 반환합니다. 기준치는 `--idle-pressure-std`, `--idle-pressure-mean`, `--idle-accel-std`, `--idle-gyro-std`로 조절할 수 있습니다.

### 3.2 오프라인 추론 (파일 입력)

```bash
cd ActionRecognitionModule/python
python sequence_infer.py \
  --model ../models/sequence_classifier.pt \
  --config ../models/sequence_config.json \
  --input ../data/raw/sequence_hug_20240616T010203.json
```

또는 JSON을 stdin으로 파이프할 수도 있습니다:

```bash
cat my_sequence.json | python sequence_infer.py --model ... --config ...
```

출력은 `{"label": "...", "probability": 0.93, ...}` 형태의 JSON입니다.

## 4. 파이프라인 통합 아이디어

- 음성 턴 시작 이벤트에서 `run_sequence_inference.js` 또는 동일한 로직을 호출해 센서 시퀀스를 버퍼링합니다.
- 턴이 끝날 때 PyTorch 추론 결과(`label`, `probability`, 전체 분포)를 LLM 입력 구조에 포함시킵니다.
- 실시간 피드백이 필요하다면 녹화 중에도 `frames`를 슬라이딩 윈도우에 넣어 즉시 행동을 추정하고, 턴 종료 시 대표 라벨을 요약할 수 있습니다.

## 5. 문제 해결

- **JSON이 비어 있음**: 녹화 중 Enter를 바로 눌렀는지 확인하세요. 최소한 몇 백 ms가 지나야 프레임이 쌓입니다.
- **PyTorch Device Error**: `--device cpu` 플래그로 강제로 CPU를 사용하세요.
- **시리얼 타임아웃**: 본래 모듈과 동일하게 StandardFirmata가 올라가 있는지, `SERIAL_PORT` 설정이 맞는지 확인하세요.

이제 음성 턴 길이와 무관하게 전체 시퀀스를 학습/추론할 수 있으므로, PillowMate의 실사용 UX와 더 자연스럽게 맞출 수 있습니다.

## 6. 음성 대화 + 행동 인식 통합 루프

루트의 `voice_chat_loop_with_action.js`는 음성 대화 루프(`voice_chat_loop.js`)에 센서 기반 행동 인식을 통합한 스크립트입니다. 마이크 입력을 받는 동안 햅틱/압력 센서를 동시에 읽어 행동 라벨을 LLM 입력과 함께 전달합니다.

```bash
# 행동 인식 로그까지 모두 보고 싶다면 ACTION_VERBOSE_LOGS=1을 앞에 붙입니다.
ACTION_VERBOSE_LOGS=1 node voice_chat_loop_with_action.js
```

- 실행 전 `ActionRecognitionModule/models/sequence_classifier_*.pt`와 config, 센서 하드웨어가 준비되어야 합니다.
- `audio.js`, `gpt_chat.js`, `config.js` 등 기존 음성 대화 의존성은 루트 README의 안내를 따릅니다.
- 내부적으로 `ActionRecognitionModule/node/run_sequence_inference.js`를 자식 프로세스로 띄워 센서 시퀀스를 수집하고, STT 결과에는 `[Detected action: ...]` 메타 정보를 덧붙여 GPT에게 전달합니다.

### 주요 옵션/동작

- `recorder.js`는 `mic` 모듈을 이용해 실시간 입력 레벨(rms)을 ASCII 바 형태로 출력합니다. 추후 `registerLedAdapter()`로 LED 표시 장치를 연결할 수 있도록 스켈레톤을 제공하고 있습니다.
- `voice_chat_loop_with_action.js` 상단의 `ACTION_OPTIONS`에서 행동 인식 모델 경로/옵션(로우패스, idle 휴리스틱, `--python-device` 등)을 조정할 수 있습니다.
- `voice_chat_loop_with_action.js` 내부 루프 구조:
  1. GPT 초기 프롬프트를 TTS로 재생.
  2. 매 턴마다 `recordAudio()`로 사용자의 발화를 녹음하면서 동시에 행동 인식 프로세스를 시작.
  3. STT 텍스트와 행동 라벨을 합쳐 GPT에 전달.
  4. GPT 응답을 TTS로 재생하고 로그에 행동/LED 패턴을 출력.

### 에러 처리/중단

- 행동 인식 프로세스는 `ActionRecognizer` 클래스로 관리되며, 각 턴마다 Enter 신호를 대신 보내고 결과 라인을 파싱합니다. 타임아웃(15초)이 발생하면 `idle` 라벨을 반환하도록 기본 처리.
- `Ctrl+C` 등으로 종료 시, 백그라운드 프로세스들을 정리한 후 종료되도록 되어 있습니다.

## 7. Idle / Activity 처리 상세

- 자동 Idle 단락 (`--auto-idle`)

  - 입력 전체를 한 번에 검사해 압력/IMU 표준편차와 압력 절대평균이 임계값 이하이면 곧바로 `--idle-label`을 반환하고 모델을 건너뜁니다.
  - 임계값 옵션: `--idle-pressure-std`, `--idle-pressure-mean`, `--idle-accel-std`, `--idle-gyro-std` (정적 상태의 실제 노이즈 수준에 맞게 올리거나 내리세요).
  - 노이즈가 많을 땐 `--low-pass-window`로 간단한 이동평균을 적용한 뒤 auto-idle을 평가하면 더 잘 동작합니다.

- 활동 블록 세분화 (`activity segmentation`)

  - 프레임마다 activity score를 만듭니다: 압력 변화량, 가속도 크기 변화량, 자이로 크기 변화량을 가중합(`--activity-weight-pressure/accel/gyro`)으로 계산.
  - 히스테리시스 임계(`--activity-high` 진입, `--activity-low` 이탈)로 on/off를 결정해 활동 구간을 찾습니다.
  - 후처리: 최소 길이 미만은 버림(`--activity-min-frames`), 앞뒤 컨텍스트 패딩(`--activity-pad-frames`), 짧은 idle 간격은 병합(`--activity-gap-merge`).
  - 검출된 블록만 모델에 보내며, 활동 블록이 없으면 idle로 간주하고 추론을 건너뜁니다.
  - `--disable-activity-segmentation`으로 끄면 전체 시퀀스를 그대로 모델에 보냅니다.

- 튜닝 팁

  - 정적 상태 노이즈가 크면 `--activity-high/low`를 올리거나 가중치 비율을 조정하세요. tap처럼 짧은 동작을 놓치면 `--activity-min-frames`를 줄이고 `--activity-pad-frames`를 늘립니다.
  - 센서 오프셋이 크면 auto-idle 임계와 activity 임계 둘 다 노이즈에 맞춰 조정하거나, 가동 직후 안정화 시간을 두고 캡처하세요.

- 예시
  ```bash
  node node/run_sequence_inference.js \
    --low-pass-window 5 \
    --auto-idle --idle-label idle \
    --idle-pressure-std 20 --idle-pressure-mean 40 \
    --idle-accel-std 0.1 --idle-gyro-std 5 \
    --activity-high 100 --activity-low 10 \
    --activity-min-frames 5 --activity-pad-frames 0 \
    --activity-gap-merge 100 \
    --activity-weight-pressure 0.000001 --activity-weight-accel 150.0 --activity-weight-gyro 500.0 \
    --activity-plot
  ```
