// audio.js : TTS - STT
import 'dotenv/config';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

const apiKey =
  process.env.OPENAI_API_KEY ||
  process.env.OPENAIKEY ||
  process.env.OPENAPIKEY ||
  process.env.openapikey;

if (!apiKey) {
  throw new Error("OpenAI API key not found. Set OPENAI_API_KEY in your environment or .env file.");
}

const openai = new OpenAI({ apiKey });
const ASSETS_DIR = path.resolve('assets');
const audioFile = path.join(ASSETS_DIR, 'audio.mp3');


// // crate a audio file from text
// await textToSpeech('Hello, Jieun how was your day?', audioFile);

// const text = await createTranscription(audioFile);
// console.log(text);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// Helpers
export async function textToSpeech(text, outputFile) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("textToSpeech: input text is empty or invalid");
  }
  const response = await withTimeout(
    openai.audio.speech.create({
      model: config.openai.tts.model,
      voice: config.openai.tts.voice,
      input: text,
    }),
    15000,
    'textToSpeech'
  );
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
