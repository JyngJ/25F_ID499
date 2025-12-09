// 텍스트 넣기 → GPT에게 보내기 → 답변 텍스트 받기

// import OpenAI from "openai";
// import "dotenv/config";

// const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// export async function askGPT(userText) {
//   const response = await client.chat.completions.create({
//     model: "gpt-4o-mini",
//     messages: [
//       { role: "user", content: userText }
//     ],
//   });

//   return response.choices[0].message.content;
// }




// gpt_chat.js
import OpenAI from 'openai';
import 'dotenv/config';
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

const COMPLETION_TIMEOUT_MS = Number(process.env.OPENAI_COMPLETION_TIMEOUT_MS || 20000);
const COMPLETION_RETRIES = Number(process.env.OPENAI_COMPLETION_RETRIES || 2);

const client = new OpenAI({
  apiKey,
  timeout: COMPLETION_TIMEOUT_MS, // request-level timeout inside the SDK
});
export const gptModel = process.env.OPENAI_GPT_MODEL || config.openai.gpt.model;
const systemPromptPath = path.resolve('prompts', 'system_prompt.txt'); // use prompts/ directory
const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
let printedConfig = false;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logOpenAIError(error, label) {
  const status = error?.status ?? error?.response?.status;
  const code = error?.code ?? error?.error?.code;
  const message = error?.message;
  console.error(`[${label}] error`, { status, code, message });
  if (message && message.includes('timeout after')) {
    console.error(`[${label}] note: this was our own timeout (${COMPLETION_TIMEOUT_MS}ms). Increase OPENAI_COMPLETION_TIMEOUT_MS if responses are slow but eventually succeed.`);
  }
  if (error?.response?.data) {
    console.error(`[${label}] response data:`, error.response.data);
  } else if (error?.response?.choices?.[0]?.message?.content) {
    console.error(`[${label}] raw content:`, error.response.choices[0].message.content);
  }
}

export async function askPillowMate(messages) {
  const jsonGuard = {
    role: 'system',
    content: 'You are a JSON API. Always and only reply with a valid JSON object. (json)',
  };
  const messagesWithSystem = [jsonGuard, { role: 'system', content: systemPrompt }, ...messages];
  if (!printedConfig) {
    console.log(
      `[askPillowMate] model=${gptModel}, timeout=${COMPLETION_TIMEOUT_MS}ms, retries=${COMPLETION_RETRIES}`
    );
    printedConfig = true;
  }

  const totalChars = messagesWithSystem.reduce(
    (sum, m) => sum + String(m.content ?? '').length,
    0
  );
  const lastUser = [...messagesWithSystem]
    .reverse()
    .find((m) => m.role === 'user')?.content;
  const lastUserPreview = lastUser
    ? lastUser.replace(/\s+/g, ' ').slice(0, 160)
    : '';

  for (let attempt = 1; attempt <= COMPLETION_RETRIES + 1; attempt++) {
    try {
      const started = Date.now();
      console.log(
        `[askPillowMate attempt ${attempt}] sending (messages=${messagesWithSystem.length}, totalChars=${totalChars}, lastUser="${lastUserPreview}")`
      );
      const response = await withTimeout(
        client.chat.completions.create({
          model: gptModel,
          messages: messagesWithSystem,
          response_format: { type: "json_object" }, // Ensure JSON output
        }),
        COMPLETION_TIMEOUT_MS,
        'askPillowMate'
      );
      const elapsed = Date.now() - started;
      console.log(`[askPillowMate attempt ${attempt}] success in ${elapsed}ms`);
      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      const isLast = attempt === COMPLETION_RETRIES + 1;
      logOpenAIError(error, `askPillowMate attempt ${attempt}`);
      if (isLast) {
        return {
          text: "미안해, 응답이 늦거나 잘 이해하지 못했어. 다시 한 번 말해줄래?",
          emotion: "neutral",
          context_label: "chat"
        };
      }
      await sleep(500 * attempt); // simple backoff
    }
  }
}
