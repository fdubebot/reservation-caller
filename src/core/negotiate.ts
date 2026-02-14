import type { ReservationRequest } from "../types/reservation.js";
import type { NegotiationDecision, ParsedBusinessReply } from "../types/negotiation.js";

function preferredTimeMinutes(r: ReservationRequest): number {
  const [h, m] = r.timePreferred.split(":").map(Number);
  return h * 60 + m;
}

function parseTimeMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function decideFromReply(reply: ParsedBusinessReply, reservation: ReservationRequest): NegotiationDecision {
  if (reply.availability === "no") {
    return { status: "reject", reason: "Business reported no availability", notes: reply.raw };
  }

  if (reply.needsCallback) {
    return { status: "clarify", reason: "Business asked for callback", notes: reply.raw };
  }

  if (reply.availability === "unknown") {
    return { status: "clarify", reason: "Ambiguous answer", notes: reply.raw };
  }

  const risky = reply.hasDeposit || reply.hasCancellationPolicy;
  if (risky) {
    return {
      status: "needs_approval",
      reason: "Deposit/cancellation condition detected",
      proposedTime: reply.offeredTimes[0],
      notes: reply.raw,
    };
  }

  const flex = reservation.constraints?.timeFlexMinutes ?? 30;
  const pref = preferredTimeMinutes(reservation);
  if (reply.offeredTimes.length > 0) {
    const best = reply.offeredTimes[0];
    const diff = Math.abs(parseTimeMinutes(best) - pref);
    if (diff > flex) {
      return {
        status: "needs_approval",
        reason: `Offered time ${best} is outside preferred window (+/-${flex}m)`,
        proposedTime: best,
        notes: reply.raw,
      };
    }
    return { status: "confirm", reason: "Availability within allowed window", proposedTime: best, notes: reply.raw };
  }

  return { status: "needs_approval", reason: "Availability yes but no explicit time extracted", notes: reply.raw };
}
