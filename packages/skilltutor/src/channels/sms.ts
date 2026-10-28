import { PinpointSMSVoiceV2Client, SendTextMessageCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2";

export async function sendSms(config: { region: string; originationIdentity: string; configurationSet: string }, to: string, body: string) {
  const client = new PinpointSMSVoiceV2Client({ region: config.region });
  const r = await client.send(new SendTextMessageCommand({
    DestinationPhoneNumber: to,
    OriginationIdentity: config.originationIdentity || undefined,
    ConfigurationSetName: config.configurationSet || undefined,
    MessageBody: body.slice(0, 320),
    MessageType: "TRANSACTIONAL",
  }));
  return r.MessageId;
}

export interface InboundSms { from: string; text: string; messageId: string }

/** Parses the two-way SMS event AWS End User Messaging SMS publishes to SNS. */
export function parseSmsEvent(snsMessage: string | Record<string, unknown>): InboundSms | null {
  const evt = (typeof snsMessage === "string" ? JSON.parse(snsMessage) : snsMessage) as Record<string, string>;
  if (!evt.originationNumber || typeof evt.messageBody !== "string") return null;
  return { from: evt.originationNumber, text: evt.messageBody, messageId: evt.inboundMessageId };
}
