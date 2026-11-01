import net from "node:net";
import tls from "node:tls";

export async function sendSmtp(input: {
  smtpUrl: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
}): Promise<void> {
  const url = new URL(input.smtpUrl);
  const port = url.port ? Number(url.port) : url.protocol === "smtps:" ? 465 : 587;
  const socket = url.protocol === "smtps:"
    ? tls.connect({ host: url.hostname, port, servername: url.hostname })
    : net.connect({ host: url.hostname, port });
  socket.setTimeout(5000, () => socket.destroy(new Error("SMTP timeout")));
  const reader = createReader(socket);
  socket.on("error", () => undefined);
  await onceOpen(socket, url.protocol === "smtps:");

  const greeting = await reader.response();
  if (!greeting.startsWith("220")) {
    throw new Error(`SMTP ${greeting}`);
  }
  await command(socket, reader, "EHLO api-monitor", "250");
  if (url.username) {
    await command(socket, reader, "AUTH LOGIN", "334");
    await command(socket, reader, Buffer.from(decodeURIComponent(url.username)).toString("base64"), "334");
    await command(socket, reader, Buffer.from(decodeURIComponent(url.password)).toString("base64"), "235");
  }
  await command(socket, reader, `MAIL FROM:${bracket(input.from)}`, "250");
  for (const recipient of input.to) {
    await command(socket, reader, `RCPT TO:${bracket(recipient)}`, "250");
  }
  await command(socket, reader, "DATA", "354");
  const subject = input.subject.replace(/[\r\n]+/g, " ");
  const body = [
    `From: ${bracket(input.from)}`,
    `To: ${input.to.map(bracket).join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    dotStuff(input.text),
    ".",
  ].join("\r\n");
  socket.write(`${body}\r\n`);
  const accepted = await reader.response();
  if (!accepted.startsWith("250")) {
    throw new Error(`SMTP ${accepted}`);
  }
  socket.write("QUIT\r\n");
  socket.end();
}

function bracket(address: string): string {
  const trimmed = address.trim();
  const wrapped = /<([^>]+)>/.exec(trimmed);
  if (wrapped) {
    return `<${wrapped[1]}>`;
  }
  return `<${trimmed}>`;
}

function dotStuff(text: string): string {
  return text.replace(/\r?\n/g, "\r\n").split("\r\n").map((line) => line.startsWith(".") ? `.${line}` : line).join("\r\n");
}

function onceOpen(socket: net.Socket, secure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => reject(error);
    socket.once("error", fail);
    socket.once(secure ? "secureConnect" : "connect", () => {
      socket.off("error", fail);
      resolve();
    });
  });
}

async function command(socket: net.Socket, reader: Reader, line: string, expected: string): Promise<void> {
  socket.write(`${line}\r\n`);
  const response = await reader.response();
  if (!response.startsWith(expected)) {
    throw new Error(`SMTP ${response}`);
  }
}

interface Reader {
  response(): Promise<string>;
}

function createReader(socket: net.Socket): Reader {
  let buffer = "";
  const pending: string[] = [];
  const waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  const fail = (error: Error) => {
    while (waiters.length > 0) {
      waiters.shift()?.reject(error);
    }
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("SMTP connection closed")));
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve(line);
      } else {
        pending.push(line);
      }
      newline = buffer.indexOf("\n");
    }
  });
  async function line(): Promise<string> {
    const queued = pending.shift();
    if (queued !== undefined) {
      return queued;
    }
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }
  return {
    async response() {
      let last = "";
      do {
        last = await line();
      } while (/^\d{3}-/.test(last));
      return last;
    },
  };
}
