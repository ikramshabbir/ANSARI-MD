import fs from "fs";
import { execFileSync } from "child_process";

function hasDrawtext(file) {
  try {
    const output = execFileSync(file, ["-filters"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });

    return /\bdrawtext\b/.test(output);
  } catch {
    return false;
  }
}

export function getFfmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "ffmpeg",
    `${process.cwd()}/bin/ffmpeg`,
    "/home/container/X-MD-main/bin/ffmpeg",

      `${process.cwd()}/node_modules/@ffmpeg-installer/linux-x64/ffmpeg`,
    `${process.cwd()}/node_modules/ffmpeg-static/ffmpeg`,
    "/home/container/X-MD-main/node_modules/ffmpeg-static/ffmpeg",
    "/data/data/com.termux/files/usr/bin/ffmpeg",
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      if (file.includes("/") && !fs.existsSync(file)) {
        continue;
      }

      if (hasDrawtext(file)) {
        return file;
      }
    } catch {}
  }

  return null;
}

export function requireFfmpegPath() {
  const ffmpegPath = getFfmpegPath();

  if (!ffmpegPath) {
    throw new Error(
      "FFmpeg with drawtext filter not found. Install FFmpeg with drawtext support or set FFMPEG_PATH."
    );
  }

  return ffmpegPath;
}
