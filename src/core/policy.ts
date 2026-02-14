import type { ReservationRequest } from "../types/reservation.js";

export function buildAssistantIntro(r: ReservationRequest) {
  return `Hi, I'm an assistant calling on behalf of ${r.nameForBooking}. We'd like a reservation for ${r.partySize} on ${r.date} around ${r.timePreferred}.`;
}

export function needsHumanConfirmation(note: string, allowAutoConfirm = false) {
  if (allowAutoConfirm) return false;
  const risky = ["deposit", "card", "fee", "cancellation", "prepay"];
  const lower = note.toLowerCase();
  return risky.some((k) => lower.includes(k));
}
