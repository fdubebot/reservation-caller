import { env } from "../config/env.js";

export async function notifyOpenClaw(event: string, payload: Record<string, unknown>) {
  if (!env.openclawCallbackUrl) return;

  try {
    await fetch(env.openclawCallbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.openclawCallbackToken
          ? { Authorization: `Bearer ${env.openclawCallbackToken}` }
          : {}),
      },
      body: JSON.stringify({ event, ...payload }),
    });
  } catch {
    // Best effort callback.
  }
}
