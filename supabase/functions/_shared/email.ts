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
const defaultLogoUrl = "https://res.cloudinary.com/dbltlcpkc/image/upload/v1780920367/freshtrace/email/logo-freshtrace.png";

type FreshTraceMailLayout = {
  title: string;
  subtitle?: string;
  greeting?: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
  accent?: "green" | "dark";
};

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

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function mailto(address: string) {
  return `mailto:${encodeURI(address.trim())}`;
}

export function renderFreshTraceEmail(options: FreshTraceMailLayout) {
  const logoUrl = Deno.env.get("EMAIL_LOGO_URL")?.trim() || defaultLogoUrl;
  const gradient = options.accent === "dark"
    ? "linear-gradient(135deg,#123d2b,#7bbf51)"
    : "linear-gradient(135deg,#0f7a4f,#75c56e)";
  const greeting = options.greeting
    ? `<p style="margin:0 0 14px;font-size:16px;">${options.greeting}</p>`
    : "";
  const cta = options.ctaLabel && options.ctaUrl
    ? `<p style="margin:28px 0;text-align:center;"><a href="${options.ctaUrl}" style="display:inline-block;border-radius:999px;background:#138a59;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;">${escapeHtml(options.ctaLabel)}</a></p>`
    : "";
  const footer = options.footer || "FreshTrace keeps clean-food orders transparent from supplier to delivery.";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body style="margin:0;background:#f4f7ef;font-family:Arial,Helvetica,sans-serif;color:#172015;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7ef;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;overflow:hidden;border-radius:28px;background:#ffffff;box-shadow:0 18px 48px rgba(23,32,21,.12);">
            <tr>
              <td style="background:${gradient};padding:30px;text-align:center;color:#ffffff;">
                <img src="${escapeHtml(logoUrl)}" width="88" height="88" alt="FreshTrace" style="display:block;margin:0 auto 14px;border-radius:22px;background:#ffffff;object-fit:contain;">
                <h1 style="margin:0;font-size:28px;line-height:1.15;">${escapeHtml(options.title)}</h1>
                ${options.subtitle ? `<p style="margin:10px 0 0;font-size:15px;opacity:.92;">${escapeHtml(options.subtitle)}</p>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${greeting}
                ${options.bodyHtml}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #edf0e8;padding:20px 32px;text-align:center;font-size:12px;color:#7a8475;">
                ${escapeHtml(footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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
