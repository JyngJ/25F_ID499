// config.js
// This file contains the configuration for the PillowMate application.
// Modify the values here to change the behavior of the application.

export const config = {
  // Initial prompt for the PillowMate
  initial_prompt: 'How was your day?',

  // SoX VAD (Voice Activity Detection) parameters
  vad: {
    // Recording starts after 0.1 seconds of sound at 3% volume
    start_threshold_duration: '0.1',
    start_threshold_volume: '3%',
    // Recording stops after 2.0 seconds of silence at 3% volume
    end_threshold_duration: '2.0',
    end_threshold_volume: '3%',
    // Maximum recording time
    max_recording_time: '5.0'
  },

  // OpenAI API parameters
  openai: {
    // Text-to-Speech (TTS)
    tts: {
      model: 'tts-1',
      voice: 'nova'
    },
    // Speech-to-Text (STT)
    stt: {
      model: 'whisper-1',
      language: 'ko'
    },
    // GPT
    gpt: {
      model: 'gpt-4o-mini'
    }
  }
};
