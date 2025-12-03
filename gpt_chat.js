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

const client = new OpenAI({ apiKey });
const systemPromptPath = path.resolve('prompts', 'system_prompt.txt'); // use prompts/ directory
const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export async function askPillowMate(messages) {
  const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...messages];

  try {
    const response = await withTimeout(
      client.chat.completions.create({
        model: config.openai.gpt.model,
        messages: messagesWithSystem,
        response_format: { type: "json_object" }, // Ensure JSON output
      }),
      5000,
      'askPillowMate'
    );

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("Failed to parse JSON response from GPT:", error);
    if (error.response?.choices?.[0]?.message?.content) {
      console.error("Raw response:", error.response.choices[0].message.content);
    }
    return {
      text: "미안해, 응답이 늦거나 잘 이해하지 못했어. 다시 한 번 말해줄래?",
      emotion: "neutral",
      context_label: "chat"
    };
  }
}
