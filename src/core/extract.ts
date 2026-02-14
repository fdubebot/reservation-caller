import type { ParsedBusinessReply } from "../types/negotiation.js";

const TIME_REGEX = /\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/g;

export function parseBusinessReply(input: string): ParsedBusinessReply {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  const yesSignals = ["yes", "available", "we can", "sure", "ok", "okay", "works", "can do"];
  const noSignals = ["not available", "fully booked", "sold out", "cannot", "can't", "no availability"];

  const availability = noSignals.some((x) => lower.includes(x))
    ? "no"
    : yesSignals.some((x) => lower.includes(x))
      ? "yes"
      : "unknown";

  const offeredTimes = Array.from(lower.matchAll(TIME_REGEX)).map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
  const hasDeposit = /\b(deposit|card hold|prepay|pre-pay|credit card)\b/.test(lower);
  const hasCancellationPolicy = /\b(cancellation|cancel fee|no-show|penalty)\b/.test(lower);
  const needsCallback = /\b(call back|callback|later)\b/.test(lower);

  const confidence = availability === "unknown" ? 0.55 : 0.82;

  return {
    raw,
    availability,
    offeredTimes,
    hasDeposit,
    hasCancellationPolicy,
    needsCallback,
    confidence,
  };
}
