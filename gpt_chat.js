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

const client = new OpenAI();

export async function askPillowMate(messages) {
  const systemPrompt = `
너는 사용자의 감정을 들어주는 베개 에이전트야.
너의 목표는 공감과 간단한 위로/행동 제안을 해주는 거야.
상대방 사용자의 응답에 따라, 너는 감정에 대한 공감과 위로 그리고 행동 제안을 할거야.
행복 관련이면 나를 흔들어봐 기쁨을 나눠보자 / 우울 슬픔 피곤 관련 나를 꼭 안아줘 위로해줄게 / 화남 관련 - 나를 마구쳐봐.
구체적인 멘트는 랜덤하게 달라지지만 제안하는 행동은 '흔들기', '치기', '끌어안기' 중에 제안되어야해.
너무 길게 말하지 말고 1~2문장 정도로 대답해줘.
`;

  const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...messages];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messagesWithSystem,
  });

  return response.choices[0].message.content;
}
