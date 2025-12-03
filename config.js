// config.js
// This file contains the configuration for the PillowMate application.
// Modify the values here to change the behavior of the application.

export const config = {
  // Initial prompt for the PillowMate
  initial_prompt: "How was your day?",

  ///////////////////////////////////////////////////////////////////
  // 이 부분 파라미터 곱셈 세팅에 문제가 있어 현재 일단 이 상태로 둡니다.
  // 의도한 바와는 다르나 현재 발화는 0.2초간 1% 이상의 음성입력,
  // 1초간 0.5% 이하의 침묵인 경우 종료로 인식되고 있는 것으로 보입니다.
  // 추후 코드 확인하여 수정하겠습니다.
  // SoX VAD (Voice Activity Detection) parameters
  vad: {
    // Recording starts after sound above threshold for start_threshold_duration (milliseconds)
    start_threshold_duration: "150", // milliseconds
    start_threshold_volume: "2%",
    // Recording stops after silence below threshold for end_threshold_duration (milliseconds)
    end_threshold_duration: "2000", // milliseconds
    end_threshold_volume: "0.5%",
    // Maximum recording time (milliseconds)
    max_recording_time: "10000", // milliseconds
  },
  ///////////////////////////////////////////////////////////////////

  // OpenAI API parameters
  openai: {
    // Text-to-Speech (TTS)
    tts: {
      model: "tts-1",
      voice: "nova",
    },
    // Speech-to-Text (STT)
    stt: {
      model: "whisper-1",
      language: "ko",
    },
    // GPT
    gpt: {
      model: "gpt-4o-mini",
    },
  },
};
