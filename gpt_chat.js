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

const client = new OpenAI();
const systemPromptPath = path.resolve('prompts', 'system_prompt.txt'); // use prompts/ directory
const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');

export async function askPillowMate(messages) {
  const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...messages];

  const response = await client.chat.completions.create({
    model: config.openai.gpt.model,
    messages: messagesWithSystem,
    response_format: { type: "json_object" }, // Ensure JSON output
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error("Failed to parse JSON response from GPT:", error);
    console.error("Raw response:", response.choices[0].message.content);
    return {
      text: "미안해, 답변을 이해할 수 없어. 다시 말해줄래?",
      emotion: "neutral",
      context_label: "chat"
    };
  }
}
