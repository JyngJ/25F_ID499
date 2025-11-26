// voice_chat.js
// 전체 파이프라인:
// STEP 0) PillowMate 질문 TTS → 재생
// STEP 1) 녹음 (JS VAD) → assets/input.wav
// STEP 2) Whisper(STT) → 텍스트
// STEP 3) GPT → 답변 텍스트 + 행동/LED 제안
// STEP 4) TTS → assets/reply.mp3
// STEP 5) afplay로 재생

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import { recordAudio } from './recorder.js';
import 'dotenv/config';
import { runCommand, getDirname, checkDependency } from './utils.js';
import { config } from './config.js';
import fs from 'fs';

// --------------------------------------------------
const __dirname = getDirname(import.meta.url); // Use getDirname

const INPUT_AUDIO_PATH  = path.join(__dirname, 'assets', 'input.wav');
const OUTPUT_AUDIO_PATH = path.join(__dirname, 'assets', 'reply.mp3');

const INITIAL_PROMPT = config.initial_prompt;

// --------------------------------------------------
async function main() {
  try {
    // 의존성 확인
    await checkDependency('rec', 'brew install sox (macOS) / conda install -c conda-forge sox');

    // ================================
    // STEP 0) PillowMate의 최초 질문
    // ================================
    try {
        await textToSpeech(INITIAL_PROMPT, OUTPUT_AUDIO_PATH);
    } catch(e) { console.log('TTS Skip:', e.message); }

    console.log('PillowMate:', INITIAL_PROMPT);
    await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);

    // ================================
    // STEP 1) 녹음 (Visual VAD)
    // ================================
    // 이전 input.wav 파일 삭제
    if (fs.existsSync(INPUT_AUDIO_PATH)) {
      fs.unlinkSync(INPUT_AUDIO_PATH);
    }
    await recordAudio(INPUT_AUDIO_PATH, {
        startThreshold: parseFloat(config.vad.start_threshold_volume) / 100.0,
        endThreshold: parseFloat(config.vad.end_threshold_volume) / 100.0,
        startThresholdDuration: parseFloat(config.vad.start_threshold_duration),
        minSilenceDuration: parseFloat(config.vad.end_threshold_duration), // Removed * 1000
        maxDuration: parseFloat(config.vad.max_recording_time) // Removed * 1000
    });
    console.log('✅ 녹음 완료:', INPUT_AUDIO_PATH);

    // ================================
    // STEP 2) STT
    // ================================
    const userText = await createTranscription(INPUT_AUDIO_PATH, 'ko'); 
    console.log('User:', userText);

    // ================================
    // STEP 3) GPT
    // ================================
    const gptResponse = await askPillowMate([{ role: 'user', content: userText }]);
    const replyText = gptResponse.text;
    const action = gptResponse.action;
    const ledPattern = gptResponse.led_pattern;

    console.log('PillowMate:', replyText);
    console.log('Action:', action);
    console.log('LED Pattern:', ledPattern);


    // ================================
    // STEP 4) TTS
    // ================================
    await textToSpeech(replyText, OUTPUT_AUDIO_PATH);
    console.log('reply.mp3 생성 완료');

    // ================================
    // STEP 5) 재생
    // ================================
    await runCommand(`afplay "${OUTPUT_AUDIO_PATH}"`);
    console.log('STEP 5) 답변 재생 중...');

  } catch (err) {
    console.error('❌ 오류:', err);
  }
}

main();
