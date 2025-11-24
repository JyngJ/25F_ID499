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
사용자의 응답에 따라, 너는 감정에 대한 공감과 위로를 해주고 다음 세 가지 물리적 행동 중 하나를 제안할 수 있어: '흔들기', '치기', '끌어안기'. 또는 아무런 행동도 제안하지 않을 수도 있어 (이 경우 'none'으로 표시).
또한, 다음 네 가지 LED 패턴 중 하나를 선택해야 해: '노란색 천천히 점멸', '빨간색 켜짐', '초록색 켜짐', '말하는 소리의 크기에 따라 점멸'.

너의 응답은 반드시 다음 JSON 형식으로 제공되어야 해:
{
  "text": "PillowMate가 사용자에게 말할 내용",
  "action": "흔들기" | "치기" | "끌어안기" | "none",
  "led_pattern": "노란색 천천히 점멸" | "빨간색 켜짐" | "초록색 켜짐" | "말하는 소리의 크기에 따라 점멸"
}
예시:
{"text": "오늘 힘든 하루였구나. 나를 꼭 안아줘.", "action": "끌어안기", "led_pattern": "초록색 켜짐"}
{"text": "좋은 일이 있었구나! 나를 흔들어서 기쁨을 표현해봐!", "action": "흔들기", "led_pattern": "노란색 천천히 점멸"}
{"text": "무슨 일 있었니? 이야기해줄래?", "action": "none", "led_pattern": "말하는 소리의 크기에 따라 점멸"}
`;

  const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...messages];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
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
      action: "none",
      led_pattern: "말하는 소리의 크기에 따라 점멸"
    };
  }
}
