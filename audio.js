// audio.js : TTS - STT
import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { log } from 'console';
import { config } from './config.js';

const openai = new OpenAI();
const ASSETS_DIR = path.resolve('assets');
const audioFile = path.join(ASSETS_DIR, 'audio.mp3');


// // crate a audio file from text
// await textToSpeech('Hello, Jieun how was your day?', audioFile);

// const text = await createTranscription(audioFile);
// console.log(text);

// Helpers
export async function textToSpeech(text, outputFile) {
  const response = await openai.audio.speech.create({
    model: config.openai.tts.model,
    voice: config.openai.tts.voice,
    input: text,
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outputFile, buffer);
}

export async function createTranscription(audio) {
  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(audio),
    model: config.openai.stt.model,
    language: config.openai.stt.language,
  });
  return response.text;
}