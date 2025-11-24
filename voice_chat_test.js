// 사람 말 (input.mp3) → Whisper(STT) → GPT → TTS → reply.mp3 → Mac 스피커로 재생

import path from 'path';
import { createTranscription, textToSpeech } from './audio.js';
import { askPillowMate } from './gpt_chat.js';
import 'dotenv/config';
import { runCommand, getDirname } from './utils.js'; // Import runCommand and getDirname

// ES module에서 __dirname 흉내 내기 (Node + import 문법일 때 필요)
const __dirname = getDirname(import.meta.url); // Use getDirname

// 1) 입력/출력 파일 경로 설정
const INPUT_FILE = "/Users/ijieun/Desktop/Interaction with AI/Project/audio code/w9-modalities/assets/input.mp3";   // 사용자가 말한 녹음
const OUTPUT_FILE = path.join(__dirname, 'assets', 'reply.mp3');  // 베개가 말할 음성

async function main() {
  try {
    console.log('1) Whisper: 음성 → 텍스트 변환 중...');
    const userText = await createTranscription(INPUT_FILE,'ko');
    console.log('User:', userText);

    console.log('2) GPT에게 보냄...');
    const replyText = await askPillowMate([{ role: 'user', content: userText }]);
    console.log('PillowMate:', replyText);

    console.log('3) TTS: GPT 답변을 음성으로 생성 중...');
    await textToSpeech(replyText, OUTPUT_FILE);
    console.log('reply.mp3 생성 완료:', OUTPUT_FILE);

    console.log('4) Mac 스피커로 재생');
    await runCommand(`afplay "${OUTPUT_FILE}"`); // Use runCommand
    console.log('재생 완료');
  } catch (err) {
    console.error('❌ Error!:', err);
  }
}

main();
