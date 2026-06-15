import { HttpError } from "./http.ts";

type MailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(500, `${name} is not configured`);
  return value;
}

function b64(value: string) {
  return btoa(unescape(encodeURIComponent(value)));
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

class SmtpConnection {
  private buffer = "";

  constructor(private conn: Deno.Conn) {}

  async readResponse() {
    const chunks: string[] = [];
    const temp = new Uint8Array(2048);
    while (true) {
      const line = await this.readLine(temp);
      chunks.push(line);
      if (/^\d{3} /.test(line)) break;
    }
    const code = Number(chunks[chunks.length - 1].slice(0, 3));
    return { code, message: chunks.join("\n") };
  }

  async command(value: string, expected: number | number[]) {
    await this.write(`${value}\r\n`);
    const response = await this.readResponse();
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(response.code)) {
      throw new HttpError(502, `SMTP command failed: ${response.message}`);
    }
    return response;
  }

  async write(value: string) {
    await this.conn.write(encoder.encode(value));
  }

  close() {
    try {
      this.conn.close();
    } catch {
      // Connection may already be closed by the SMTP server.
    }
  }

  replaceConn(conn: Deno.Conn) {
    this.conn = conn;
    this.buffer = "";
  }

  private async readLine(temp: Uint8Array) {
    while (!this.buffer.includes("\n")) {
      const count = await this.conn.read(temp);
      if (count === null) throw new HttpError(502, "SMTP connection closed unexpectedly");
      this.buffer += decoder.decode(temp.subarray(0, count));
    }
    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index + 1).replace(/\r?\n$/, "");
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }
}

export async function sendMail(options: MailOptions) {
  const host = requiredEnv("SMTP_HOST");
  const user = requiredEnv("SMTP_USER");
  const pass = requiredEnv("SMTP_PASS");
  const adminEmail = Deno.env.get("SMTP_ADMIN_EMAIL")?.trim() || user;
  const senderName = Deno.env.get("SMTP_SENDER_NAME")?.trim() || "FreshTrace";
  const port = Number(Deno.env.get("SMTP_PORT")?.trim() || "587");
  const isImplicitTls = port === 465;
  let tcpConn: Deno.TcpConn | null = null;
  const conn = isImplicitTls
    ? await Deno.connectTls({ hostname: host, port })
    : (tcpConn = await Deno.connect({ hostname: host, port }));
  const smtp = new SmtpConnection(conn);

  const from = `${safeHeader(senderName)} <${safeHeader(adminEmail)}>`;
  const plain = options.text ?? options.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const boundary = `freshtrace-${crypto.randomUUID()}`;
  const message = [
    `From: ${from}`,
    `To: ${safeHeader(options.to)}`,
    ...(options.replyTo ? [`Reply-To: ${safeHeader(options.replyTo)}`] : []),
    `Subject: ${safeHeader(options.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    options.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  try {
    await smtp.readResponse();
    await smtp.command(`EHLO ${host}`, 250);
    if (!isImplicitTls) {
      await smtp.command("STARTTLS", 220);
      const tlsConn = await Deno.startTls(tcpConn!, { hostname: host });
      smtp.replaceConn(tlsConn);
      await smtp.command(`EHLO ${host}`, 250);
    }
    await smtp.command("AUTH LOGIN", 334);
    await smtp.command(b64(user), 334);
    await smtp.command(b64(pass), 235);
    await smtp.command(`MAIL FROM:<${adminEmail}>`, 250);
    await smtp.command(`RCPT TO:<${options.to}>`, [250, 251]);
    await smtp.command("DATA", 354);
    await smtp.write(`${message.replace(/\r?\n\./g, "\r\n..")}\r\n.\r\n`);
    const queued = await smtp.readResponse();
    if (queued.code !== 250) throw new HttpError(502, `SMTP delivery failed: ${queued.message}`);
    await smtp.command("QUIT", 221);
  } finally {
    smtp.close();
  }
}
