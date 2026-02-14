import twilio from "twilio";
import { env, hasTwilioConfig } from "../config/env.js";

export async function createOutboundCall(params: {
  to: string;
  callId: string;
}) {
  if (!hasTwilioConfig()) {
    throw new Error("Twilio credentials are not configured");
  }

  const client = twilio(env.twilioAccountSid, env.twilioAuthToken);

  const voiceUrl = `${env.appBaseUrl}/api/twilio/voice?callId=${encodeURIComponent(params.callId)}`;
  const statusCallback = `${env.appBaseUrl}/api/twilio/status?callId=${encodeURIComponent(params.callId)}`;

  const call = await client.calls.create({
    to: params.to,
    from: env.twilioPhoneNumber,
    url: voiceUrl,
    statusCallback,
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });

  return call;
}
