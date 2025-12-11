# PillowMate: AI 기반 감정 지원 베개 에이전트

PillowMate는 Node.js 기반의 인공지능 감정 지원 에이전트로, 음성 대화, 물리적 행동 제안, 그리고 LED 피드백을 통해 사용자에게 공감과 위로를 제공합니다. 사용자의 감정을 이해하고 적절한 상호작용을 제안하여 정서적 지원을 목표로 합니다.

## 주요 기능

*   **음성 상호작용:** 시각적 피드백이 포함된 실시간 음성 활동 감지(VAD)를 통해 사용자의 발화를 정확하게 인식하고, GPT 기반으로 자연스러운 대화를 나눕니다.
*   **감정 공감 및 행동 제안:** 사용자의 음성 내용에 따라 GPT가 감정을 분석하고, '베개를 흔들기', '치기', '끌어안기'와 같은 물리적 상호작용을 제안합니다.
*   **LED 피드백:** GPT의 응답과 행동 제안에 따라 베개의 LED 패턴을 변경하여 시각적인 피드백을 제공합니다.
*   **쉬운 설정:** 시스템 프롬프트, 모델 종류, 음성 인식 감도 등 주요 설정을 별도 파일로 분리하여 코드 수정 없이 쉽게 변경할 수 있습니다.
*   **모듈화된 코드:** TTS/STT, GPT 통신, 유틸리티 기능 등이 모듈화되어 있어 유지보수 및 확장성이 용이합니다.

## 시작하기

PillowMate를 실행하려면 다음 단계를 따르세요.

### 1. 전제 조건 설치

이 프로젝트는 Node.js, Conda, 그리고 SoX (Sound eXchange)를 필요로 합니다.

*   **Node.js:** [Node.js 공식 웹사이트](https://nodejs.org/)에서 최신 버전을 다운로드하여 설치하세요.
*   **Conda:** [Anaconda](https://www.anaconda.com/products/distribution) 또는 [Miniconda](https://docs.conda.io/en/latest/miniconda.html)를 설치하세요.
*   **SoX:** 마이크 사용을 위해 필수입니다.
    *   **Conda (추천):**
        ```bash
        conda install -c conda-forge sox
        ```
    *   **macOS (Homebrew):** `brew install sox`
    *   **Linux:** `sudo apt install sox`

### 2. 프로젝트 설정

1.  프로젝트 저장소를 클론(clone)하거나 다운로드합니다.
    ```bash
    git clone https://github.com/JyngJ/ID430_final.git
    cd ID430_final 
    ```

2.  Node.js 패키지를 설치합니다.
    ```bash
    npm install
    ```

3.  `.env` 파일 설정: 프로젝트 루트 디렉토리에 `.env` 파일을 생성하고, OpenAI API 키를 추가합니다.
    ```
    OPENAI_API_KEY=YOUR_OPENAI_API_KEY
    SERIAL_PORT=/dev/tty.usbmodem141101
    ```
    `YOUR_OPENAI_API_KEY` 부분을 자신의 OpenAI API 키로 교체하세요. 그리고`SERIAL_PORT` 값을 넣어 주세요(센서/보드 연결 포트).

### 3. 설정

PillowMate의 행동과 기술적 세부 사항은 두 개의 파일을 통해 쉽게 설정할 수 있습니다.

*   **`system_prompt.txt`**: PillowMate의 정체성, 역할, 목표, 응답 규칙을 정의하는 파일입니다. 이 파일을 수정하여 PillowMate의 페르소나를 변경할 수 있습니다.
*   **`config.js`**: 애플리케이션의 기술적인 설정을 담고 있는 파일입니다. GPT/TTS/STT 모델, 음성 인식 감도(VAD), 초기 메시지 등을 이 파일에서 수정할 수 있습니다.

### 4. 애플리케이션 실행

애플리케이션은 단일 대화 턴 또는 연속 루프 모드로 실행할 수 있습니다. 실행 시 화면에 나타나는 볼륨 막대(`Volume: [███   ]`)를 통해 마이크 입력 상태를 확인할 수 있습니다.

*   **단일 대화 턴 실행:**
    ```bash
    node voice_chat.js
    ```
    이 명령은 PillowMate가 질문하고, 사용자가 응답한 후 PillowMate가 답변하는 단일 대화 사이클을 실행합니다.

*   **연속 대화 루프 실행:**
    ```bash
    node voice_chat_loop_with_action_inline.js
    ```
    이 명령은 PillowMate와 사용자 간의 대화 사이클을 계속 반복합니다. Action 인식 Inline 모듈이 포함된 현재 메인 실행 진입점입니다.

### Action 인식 단독 테스트 (run_sequence_inference.js)

Action 인식만 따로 점검하려면 ActionRecognitionModule/node/run_sequence_inference.js를 실행하세요.

1.  ActionRecognitionModule/.env에 `SERIAL_PORT`를 설정합니다(루트 .env의 포트값과 동일하게 맞추면 됩니다).
2.  Python과 PyTorch가 준비돼 있어야 합니다(`python` 명령과 ActionRecognitionModule/python/sequence_infer.py가 동작해야 합니다).
3.  다음 명령으로 실행:
    ```bash
    node node/run_sequence_inference.js \
    --model models/251210pillowmate_full.pt \
    --config models/251210pillowmate_full.json \
    --low-pass-window 5 \
    --auto-idle --idle-label idle \
    --idle-pressure-std 20 --idle-pressure-mean 40 \
    --idle-accel-std 0.1 --idle-gyro-std 5 \
    --activity-high 100 --activity-low 10 \
    --activity-min-frames 5 --activity-pad-frames 0 \
    --activity-gap-merge 100 \
    --activity-weight-pressure 0.000002 --activity-weight-accel 150.0 --activity-weight-gyro 500.0 \
    --activity-plot \
    --sample-log-every 50
    ```
    Enter를 눌러 녹음을 시작/종료하면, 수집된 센서 데이터를 Python 모듈이 추론해 label/probability를 출력합니다.

## 코드 구조

*   `config.js`: GPT 모델, 음성 인식 감도 등 기술적 설정을 관리합니다.
*   `system_prompt.txt`: PillowMate 에이전트의 페르소나와 규칙을 정의합니다.
*   `audio.js`: OpenAI TTS(Text-to-Speech) 및 STT(Speech-to-Text) 기능을 제공합니다.
*   `gpt_chat.js`: PillowMate 페르소나를 가진 GPT 모델과 통신하며, JSON 형식으로 텍스트, 행동 제안, LED 패턴을 반환합니다.
*   `recorder.js`: 시각적 피드백이 포함된 마이크 녹음 및 VAD(음성 활동 감지) 모듈입니다.
*   `utils.js`: `runCommand`, `getDirname`, `sleep`과 같은 공통 유틸리티 함수를 포함합니다.
*   `voice_chat.js`: 단일 대화 턴을 처리하는 메인 스크립트입니다.
*   `voice_chat_loop_with_action_inline.js`: 연속 대화 루프를 처리하며 Inline Action 인식 모듈을 포함한 메인 스크립트입니다.
*   `neopixel_controller.js`: 감정/상태에 따라 네오픽셀 LED 패턴을 구동하는 컨트롤러입니다(보드 포트는 `.env`의 `SERIAL_PORT`로 지정).
*   `assets/`: 녹음된 사용자 음성(`input.wav`) 및 PillowMate 응답 오디오(`reply.mp3`)를 저장합니다.
