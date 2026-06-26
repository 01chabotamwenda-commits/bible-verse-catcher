import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage, Server } from "http";
import { logger } from "./logger";

const DEEPGRAM_URL =
  "wss://api.deepgram.com/v1/listen" +
  "?model=nova-2" +
  "&language=en-US" +
  "&smart_format=true" +
  "&interim_results=true" +
  "&utterance_end_ms=1000";

// Send a KeepAlive to Deepgram every 8 seconds so the connection never idles out.
// Deepgram documents this as the official way to hold an open connection.
const KEEPALIVE_INTERVAL_MS = 8_000;

export function attachTranscribeWs(httpServer: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/transcribe")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (clientWs: WebSocket) => {
    const apiKey = process.env["DEEPGRAM_API_KEY"];
    if (!apiKey) {
      logger.error("DEEPGRAM_API_KEY not set");
      clientWs.send(JSON.stringify({ type: "error", message: "Server missing Deepgram API key" }));
      clientWs.close(1011);
      return;
    }

    logger.info("Transcribe WS: client connected, opening Deepgram socket");

    const dgWs = new WebSocket(DEEPGRAM_URL, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    let audioChunksReceived = 0;
    let dgMessagesReceived = 0;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

    const stopKeepAlive = () => {
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    };

    dgWs.on("open", () => {
      logger.info("Transcribe WS: Deepgram connection open");
      clientWs.send(JSON.stringify({ type: "connected" }));

      // Keepalive — prevents Deepgram and any proxy from timing out the connection
      keepAliveTimer = setInterval(() => {
        if (dgWs.readyState === WebSocket.OPEN) {
          dgWs.send(JSON.stringify({ type: "KeepAlive" }));
        } else {
          stopKeepAlive();
        }
      }, KEEPALIVE_INTERVAL_MS);
    });

    dgWs.on("message", (data) => {
      dgMessagesReceived++;
      const text = data.toString();
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const type = parsed["type"] as string;
        if (type === "Results") {
          const channel = parsed["channel"] as Record<string, unknown> | undefined;
          const alts = channel?.["alternatives"] as Array<{ transcript?: string }> | undefined;
          const transcript = alts?.[0]?.transcript ?? "";
          const isFinal = parsed["is_final"] as boolean | undefined;
          if (transcript) {
            logger.info({ transcript, isFinal }, "Transcribe WS: Deepgram result");
          }
        }
      } catch { /* non-JSON, ignore */ }

      if (clientWs.readyState === WebSocket.OPEN) {
        // Send as text frame so the browser can JSON.parse it
        clientWs.send(text);
      }
    });

    dgWs.on("error", (err) => {
      stopKeepAlive();
      logger.error({ err }, "Transcribe WS: Deepgram error");
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", message: err.message }));
        clientWs.close(1011);
      }
    });

    dgWs.on("close", (code, reason) => {
      stopKeepAlive();
      logger.info({ code, reason: reason.toString(), audioChunksReceived, dgMessagesReceived }, "Transcribe WS: Deepgram closed");
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(1000);
      }
    });

    clientWs.on("message", (data) => {
      audioChunksReceived++;
      if (audioChunksReceived === 1 || audioChunksReceived % 100 === 0) {
        logger.info({ audioChunksReceived, bytes: (data as Buffer).length }, "Transcribe WS: audio flowing to Deepgram");
      }
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(data as Buffer);
      }
    });

    clientWs.on("close", (code) => {
      stopKeepAlive();
      logger.info({ code, audioChunksReceived, dgMessagesReceived }, "Transcribe WS: client disconnected");
      if (dgWs.readyState === WebSocket.OPEN) {
        dgWs.close(1000);
      }
    });

    clientWs.on("error", (err) => {
      stopKeepAlive();
      logger.error({ err }, "Transcribe WS: client socket error");
      if (dgWs.readyState === WebSocket.OPEN) dgWs.close();
    });
  });

  logger.info("Transcribe WebSocket handler attached");
}
