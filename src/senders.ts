import type { Channel } from './events.ts';

export interface Sender {
  /** Delivers one message. `to` is an email address for email and a user id for push. Throws if delivery fails. */
  send(channel: Channel, to: string, subject: string, body: string): Promise<void>;
}

/** Stand-in for the real email and push providers: prints the message. */
export class LogSender implements Sender {
  async send(channel: Channel, to: string, subject: string) {
    console.log(JSON.stringify({ sent: channel, to, subject }));
  }
}

export class MemorySender implements Sender {
  sent: { channel: Channel; to: string; subject: string; body: string }[] = [];
  failOn: Channel | null = null;
  async send(channel: Channel, to: string, subject: string, body: string) {
    if (this.failOn === channel) throw new Error(`${channel} provider down`);
    this.sent.push({ channel, to, subject, body });
  }
}
