import { addTranscript, getCall, setOutcome, updateStatus } from "./store.js";
import { notifyOpenClaw } from "./notify.js";

export function applyDecision(id: string, decision: "approve" | "revise" | "cancel", notes: string | undefined) {
  const call = getCall(id);
  if (!call) return { error: "Call not found" as const };

  if (decision === "approve") {
    setOutcome(id, {
      status: "confirmed",
      needsUserApproval: false,
      confidence: 0.95,
      reason: "Approved by user",
      confirmedDetails: {
        date: call.reservation.date,
        time: call.reservation.timePreferred,
        partySize: call.reservation.partySize,
        name: call.reservation.nameForBooking,
        notes,
      },
    });
    updateStatus(id, "CONFIRMED");
    void notifyOpenClaw("call_confirmed", {
      callId: id,
      businessName: call.reservation.businessName,
      confirmed: {
        date: call.reservation.date,
        time: call.reservation.timePreferred,
        partySize: call.reservation.partySize,
        name: call.reservation.nameForBooking,
      },
    });
  } else if (decision === "cancel") {
    setOutcome(id, { status: "failed", needsUserApproval: false, confidence: 1, reason: "Cancelled by user" });
    updateStatus(id, "FAILED");
    void notifyOpenClaw("call_cancelled", { callId: id, businessName: call.reservation.businessName });
  } else {
    updateStatus(id, "NEGOTIATION");
    addTranscript(id, "system", `User revision requested: ${notes || "(no notes)"}`);
  }

  return { call: getCall(id) };
}
