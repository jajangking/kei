let latestFrame: ArrayBuffer | null = null;
let frameTimestamp = 0;

export async function POST(req: Request) {
  latestFrame = await req.arrayBuffer();
  frameTimestamp = Date.now();
  return new Response("ok", { status: 200 });
}

export async function GET() {
  if (!latestFrame) {
    return new Response("no frame", { status: 404 });
  }
  return new Response(latestFrame as BodyInit, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store, max-age=0",
      "X-Timestamp": String(frameTimestamp),
    },
  });
}

export const dynamic = "force-dynamic";
