export const dynamic = "force-dynamic";

import { EdgeTTS } from "node-edge-tts";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const text = searchParams.get("text");
  const voice = searchParams.get("voice") || "id-ID-GadisNeural";

  if (!text || text.length > 5000) {
    return new Response("Missing or too long text", { status: 400 });
  }

  let tmpPath = "";
  try {
    const tts = new EdgeTTS({ voice, timeout: 15000 });
    tmpPath = join(tmpdir(), `edgetts-${randomUUID()}.mp3`);
    await tts.ttsPromise(text, tmpPath);
    const audio = await readFile(tmpPath);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e: any) {
    return new Response(`Edge TTS error: ${e.message}`, { status: 502 });
  } finally {
    if (tmpPath) unlink(tmpPath).catch(() => {});
  }
}
