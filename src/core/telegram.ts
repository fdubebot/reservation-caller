import { env } from "../config/env.js";

type ApprovalPayload = {
  callId: string;
  businessName: string;
  date: string;
  time: string;
  partySize: number;
  notes?: string;
};

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${env.telegramBotToken}/${method}`;
}

export function hasTelegramConfig() {
  return Boolean(env.telegramBotToken && env.telegramChatId);
}

export async function sendApprovalPrompt(payload: ApprovalPayload) {
  if (!hasTelegramConfig()) return;

  const text = [
    "📞 Reservation approval needed",
    `Call: ${payload.businessName}`,
    `When: ${payload.date} ${payload.time}`,
    `Party size: ${payload.partySize}`,
    payload.notes ? `Notes: ${payload.notes}` : undefined,
    "",
    `Call ID: ${payload.callId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const body = {
    chat_id: env.telegramChatId,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `rc|approve|${payload.callId}` },
          { text: "✏️ Revise", callback_data: `rc|revise|${payload.callId}` },
          { text: "❌ Cancel", callback_data: `rc|cancel|${payload.callId}` },
        ],
      ],
    },
  };

  try {
    await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // best effort
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text: string) {
  if (!hasTelegramConfig()) return;
  try {
    await fetch(apiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch {
    // best effort
  }
}

export async function editMessage(chatId: string | number, messageId: number, text: string) {
  if (!hasTelegramConfig()) return;
  try {
    await fetch(apiUrl("editMessageText"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
      }),
    });
  } catch {
    // best effort
  }
}

export async function sendMessage(chatId: string | number, text: string) {
  if (!hasTelegramConfig()) return;
  try {
    await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
  } catch {
    // best effort
  }
}
