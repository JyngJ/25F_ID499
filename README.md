# PillowMate: AI 기반 감정 지원 베개 에이전트

PillowMate는 Node.js 기반의 인공지능 감정 지원 에이전트로, 음성 대화, 물리적 행동 제안, 그리고 LED 피드백을 통해 사용자에게 공감과 위로를 제공합니다. 사용자의 감정을 이해하고 적절한 상호작용을 제안하여 정서적 지원을 목표로 합니다.

## 주요 기능

*   **음성 상호작용:** 실시간 음성 활동 감지(VAD)를 통해 사용자의 발화를 정확하게 인식하고, GPT 기반으로 자연스러운 대화를 나눕니다.
*   **감정 공감 및 행동 제안:** 사용자의 음성 내용에 따라 GPT가 감정을 분석하고, '베개를 흔들기', '치기', '끌어안기'와 같은 물리적 상호작용을 제안합니다.
*   **LED 피드백:** GPT의 응답과 행동 제안에 따라 베개의 LED 패턴을 변경하여 시각적인 피드백을 제공합니다. (예: 노란색 천천히 점멸, 빨간색 켜짐, 초록색 켜짐, 말하는 소리 크기에 따른 점멸)
*   **모듈화된 코드:** TTS/STT, GPT 통신, 유틸리티 기능 등이 모듈화되어 있어 유지보수 및 확장성이 용이합니다.

## 시작하기

PillowMate를 실행하려면 다음 단계를 따르세요.

### 1. 전제 조건 설치

이 프로젝트는 Node.js와 SoX (Sound eXchange)를 필요로 합니다.

*   **Node.js:** [Node.js 공식 웹사이트](https://nodejs.org/)에서 최신 버전을 다운로드하여 설치하세요.
*   **SoX:** macOS 사용자의 경우 Homebrew를 통해 설치할 수 있습니다.
    ```bash
    brew install sox
    ```
    다른 운영체제의 경우 [SoX 공식 웹사이트](http://sox.sourceforge.net/)를 참조하여 설치하세요.

### 2. 프로젝트 설정

1.  프로젝트 저장소를 클론(clone)하거나 다운로드합니다.
    ```bash
    git clone git@github.com:JyngJ/25F_ID499.git
    cd 25F_ID499 # 또는 프로젝트 디렉토리명
    ```

2.  Node.js 패키지를 설치합니다.
    ```bash
    npm install
    ```

3.  `.env` 파일 설정: 프로젝트 루트 디렉토리에 `.env` 파일을 생성하고, OpenAI API 키를 추가합니다.
    ```
    OPENAI_API_KEY=YOUR_OPENAI_API_KEY
    ```
    `YOUR_OPENAI_API_KEY` 부분을 자신의 OpenAI API 키로 교체하세요.

### 3. 애플리케이션 실행

애플리케이션은 단일 대화 턴 또는 연속 루프 모드로 실행할 수 있습니다.

*   **단일 대화 턴 실행:**
    ```bash
    node voice_chat.js
    ```
    이 명령은 PillowMate가 질문하고, 사용자가 응답한 후 PillowMate가 답변하는 단일 대화 사이클을 실행합니다.

*   **연속 대화 루프 실행:**
    ```bash
    node "voice_chat(loop).js"
    ```
    이 명령은 PillowMate와 사용자 간의 대화 사이클을 계속 반복합니다.

## 코드 구조

*   `audio.js`: OpenAI TTS(Text-to-Speech) 및 STT(Speech-to-Text) 기능을 제공합니다.
*   `gpt_chat.js`: PillowMate 페르소나를 가진 GPT 모델과 통신하며, JSON 형식으로 텍스트, 행동 제안, LED 패턴을 반환합니다.
*   `utils.js`: `runCommand`, `getDirname`, `sleep`과 같은 공통 유틸리티 함수를 포함합니다.
*   `voice_chat.js`: 단일 대화 턴을 처리하는 메인 스크립트입니다.
*   `voice_chat(loop).js`: 연속 대화 루프를 처리하는 스크립트입니다.
*   `assets/`: 녹음된 사용자 음성(`input.wav`) 및 PillowMate 응답 오디오(`reply.mp3`)를 저장합니다.

---
**주의:** `voice_chat(loop).js` 실행 시 파일명에 괄호가 있으므로, 셸에서 실행할 때는 `node "voice_chat(loop).js"`와 같이 따옴표로 묶어주세요.
