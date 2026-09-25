import { command } from "../plugins.js";
import { getCommandArgs } from "../utils/message.js";
import { isOwnerMessage } from "../utils/access.js";
import { downloadContentFromMessage } from "baileys";

async function streamToBuffer(stream) {
  const chunks = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

command(
  {
    pattern: "repeat",
    fromMe: false,
    desc: "Repeat replied message 1-100 times",
    type: "owner",
  },

  async (message, conn) => {
    if (!isOwnerMessage(message, conn)) return;

    const args = (getCommandArgs(message.body, "repeat") || "").trim();

    if (!/^\d+$/.test(args)) return;

    const count = Number(args);

    if (count < 1 || count > 100) return;

    const quoted = message.quoted;

    if (!quoted?.raw || !quoted?.messageTypeKey) return;

    const type = quoted.messageTypeKey;

    // TEXT
    if (type === "conversation" || type === "extendedTextMessage") {
      const text =
        quoted.text ||
        quoted.raw?.conversation ||
        quoted.raw?.extendedTextMessage?.text ||
        "";

      if (!text) return;

      for (let i = 0; i < count; i++) {
        await conn.sendMessage(message.from, { text });
      }

      return;
    }

    // MEDIA
    const mediaTypes = {
      imageMessage: "image",
      videoMessage: "video",
      audioMessage: "audio",
      documentMessage: "document",
      stickerMessage: "sticker",
    };

    const mediaType = mediaTypes[type];

    if (!mediaType) return;

    const mediaMessage = quoted.raw?.[type];

    if (!mediaMessage) return;

    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
    const buffer = await streamToBuffer(stream);

    const options = {};

    if (mediaType === "audio") {
      options.ptt = Boolean(mediaMessage.ptt);
    }

    if (mediaType === "document") {
      options.fileName = mediaMessage.fileName || "document";
      options.mimetype =
        mediaMessage.mimetype || "application/octet-stream";
    }

    if (mediaType === "video") {
      options.mimetype = mediaMessage.mimetype || "video/mp4";
      options.caption = mediaMessage.caption || undefined;
    }

    if (mediaType === "image") {
      options.mimetype = mediaMessage.mimetype || "image/jpeg";
      options.caption = mediaMessage.caption || undefined;
    }

    for (let i = 0; i < count; i++) {
      await conn.sendMessage(message.from, {
        [mediaType]: buffer,
        ...options,
      });
    }
  }
);
