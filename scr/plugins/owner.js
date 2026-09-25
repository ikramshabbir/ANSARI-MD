/**
 * Owner / sudo / mode / autoreact commands
 */

import { command } from "../plugins.js";

import {
  reply,
  replyOk,
  replyFail,
  getCommandArgs,
} from "../utils/message.js";

import {
  getMode,
  setMode,
  listSudo,
  addSudo,
  removeSudo,
  isOwnerMessage,
  normalizeNumber,
} from "../utils/access.js";

import { resolveTargetUser } from "../utils/group.js";
import { BOT_INFO } from "../config/constants.js";
import { kvGet, kvSet } from "../database/botKv.js";


/* =========================
   BOT MODE
========================= */

command(
  {
    pattern: "mode",
    fromMe: true,
    desc: "Show or set bot mode (public|private)",
    type: "owner",
  },

  async (message, conn, sessionId = "default") => {
    const autoreactKey = `autoreact:${sessionId}`;

    const args = (
      getCommandArgs(message.body, "mode") || ""
    )
      .trim()
      .toLowerCase();

    if (!args) {
      const mode = await getMode();

      await reply(
        conn,
        message,
        `*Bot mode:* ${mode}\n\n` +
          `• \`${BOT_INFO.PREFIX}mode public\` — anyone can use commands\n` +
          `• \`${BOT_INFO.PREFIX}mode private\` — owner + sudo only`
      );

      return;
    }

    if (args !== "public" && args !== "private") {
      await replyFail(
        conn,
        message,
        `Use \`${BOT_INFO.PREFIX}mode public\` or \`${BOT_INFO.PREFIX}mode private\``
      );

      return;
    }

    const next = await setMode(args);

    await replyOk(
      conn,
      message,
      `Mode set to *${next}*`
    );
  }
);


/* =========================
   SUDO
========================= */

command(
  {
    pattern: "sudo",
    fromMe: true,
    desc: "Manage sudo users (add|del|list)",
    type: "owner",
  },

  async (message, conn) => {
    const raw = (
      getCommandArgs(message.body, "sudo") || ""
    ).trim();

    const [action, ...rest] = raw.split(/\s+/);

    const act = (
      action || "list"
    ).toLowerCase();

    if (act === "list" || !action) {
      const list = await listSudo();

      if (!list.length) {
        await reply(
          conn,
          message,
          "*Sudo list:* _(empty)_"
        );

        return;
      }

      await reply(
        conn,
        message,
        `*Sudo list:*\n${list
          .map((n, i) => `${i + 1}. ${n}`)
          .join("\n")}`
      );

      return;
    }

    if (!isOwnerMessage(message, conn)) {
      await replyFail(
        conn,
        message,
        "Only the bot owner can add/remove sudo."
      );

      return;
    }

    let target =
      rest.join(" ").trim() ||
      resolveTargetUser(message) ||
      "";

    const mentions =
      message.message?.contextInfo?.mentionedJid || [];

    if (!target && mentions.length) {
      target = mentions[0];
    }

    const number = normalizeNumber(target);

    if (
      !number &&
      (
        act === "add" ||
        act === "del" ||
        act === "remove" ||
        act === "rm"
      )
    ) {
      await replyFail(
        conn,
        message,
        `Usage: \`${BOT_INFO.PREFIX}sudo add <number|@user>\` / \`${BOT_INFO.PREFIX}sudo del <number|@user>\``
      );

      return;
    }

    if (act === "add") {
      await addSudo(number);

      await replyOk(
        conn,
        message,
        `Added sudo: *${number}*`
      );

      return;
    }

    if (
      act === "del" ||
      act === "remove" ||
      act === "rm"
    ) {
      await removeSudo(number);

      await replyOk(
        conn,
        message,
        `Removed sudo: *${number}*`
      );

      return;
    }

    await replyFail(
      conn,
      message,
      "Unknown action. Use `list`, `add`, or `del`."
    );
  }
);


/* =========================
   AUTO REACTION MODES
   ========================= */
command(
  {
    pattern: "autoreact",
    fromMe: true,
    desc: "Control automatic emoji reaction mode",
    type: "owner",
  },

  async (message, conn, sessionId = "default") => {
    const autoreactKey = `autoreact:${sessionId}`;

    const args = (
      getCommandArgs(message.body, "autoreact") || ""
    )
      .trim()
      .toLowerCase();

    const stored = await kvGet(autoreactKey);

    const current =
      stored === true
        ? "on"
        : stored === false || stored == null
          ? "off"
          : String(stored).toLowerCase();

    /* Show current status */
    if (!args || args === "status") {
      let statusText;

      if (current === "on") {
        statusText = "ON — Groups + Private ✅";
      } else if (current === "group") {
        statusText = "GROUP ONLY — Groups ✅";
      } else if (current === "private") {
        statusText = "PRIVATE ONLY — Private Chats ✅";
      } else {
        statusText = "OFF ❌";
      }

      await reply(
        conn,
        message,
        `🤖 *Auto Reaction:* ${statusText}\n\n` +
          `• \`${BOT_INFO.PREFIX}autoreact on\` — Groups + Private\n` +
          `• \`${BOT_INFO.PREFIX}autoreact group\` — Groups only\n` +
          `• \`${BOT_INFO.PREFIX}autoreact private\` — Private only\n` +
          `• \`${BOT_INFO.PREFIX}autoreact off\` — OFF\n` +
          `• \`${BOT_INFO.PREFIX}autoreact status\` — Current status`
      );

      return;
    }

    /* Groups + Private */
    if (args === "on") {
      await kvSet(autoreactKey, "on");

      await replyOk(
        conn,
        message,
        "✅ Auto Reaction is now ON — Groups + Private ❤️"
      );

      return;
    }

    /* OFF everywhere */
    if (args === "off") {
      await kvSet(autoreactKey, "off");

      await replyOk(
        conn,
        message,
        "❌ Auto Reaction is now OFF"
      );

      return;
    }

    /* Groups only */
    if (args === "group") {
      await kvSet(autoreactKey, "group");

      await replyOk(
        conn,
        message,
        "✅ Auto Reaction is now ON — Groups only"
      );

      return;
    }

    /* Private chats only */
    if (args === "private") {
      await kvSet(autoreactKey, "private");

      await replyOk(
        conn,
        message,
        "✅ Auto Reaction is now ON — Private chats only"
      );

      return;
    }

    /* Invalid option */
    await replyFail(
      conn,
      message,
      `Use \`${BOT_INFO.PREFIX}autoreact on\`, ` +
        `\`${BOT_INFO.PREFIX}autoreact off\`, ` +
        `\`${BOT_INFO.PREFIX}autoreact group\`, or ` +
        `\`${BOT_INFO.PREFIX}autoreact private\``
    );
  }
);

/* =========================
   PRESENCE MODE
========================= */

command(
  {
    pattern: "presence",
    fromMe: true,
    desc: "Choose last seen / online presence mode",
    type: "owner",
  },

  async (message, conn, sessionId = "default") => {
    const presenceKey = `presence:${sessionId}`;

    const args = (
      getCommandArgs(message.body, "presence") || ""
    )
      .trim()
      .toLowerCase();

    const current = await kvGet(presenceKey) || "normal";

    /* Show current status */
    if (!args || args === "status") {
      const labels = {
        normal: "Normal",
        freeze: "Freeze",
        always: "Always Online",
      };

      await reply(
        conn,
        message,
        `👁️ *Presence:* ${labels[current] || "Normal"}\n\n` +
          `• \`${BOT_INFO.PREFIX}presence 1\` — Normal\n` +
          `• \`${BOT_INFO.PREFIX}presence 2\` — Freeze\n` +
          `• \`${BOT_INFO.PREFIX}presence 3\` — Always Online`
      );

      return;
    }

    if (args === "1") {
      await kvSet(presenceKey, "normal");
      await conn.sendPresenceUpdate("unavailable");

      await replyOk(
        conn,
        message,
        "👁️ Presence set to *Normal*"
      );

      return;
    }

    if (args === "2") {
      await kvSet(presenceKey, "freeze");
      await conn.sendPresenceUpdate("unavailable");

      await replyOk(
        conn,
        message,
        "👁️ Presence set to *Freeze*"
      );

      return;
    }

    if (args === "3") {
      await kvSet(presenceKey, "always");
      await conn.sendPresenceUpdate("available");

      await replyOk(
        conn,
        message,
        "👁️ Presence set to *Always Online*"
      );

      return;
    }

    await replyFail(
      conn,
      message,
      `Use \`${BOT_INFO.PREFIX}presence 1\`, \`${BOT_INFO.PREFIX}presence 2\`, or \`${BOT_INFO.PREFIX}presence 3\``
    );
  }
);
