export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) return new Response("Missing url param", { status: 400 });

  try {
    const resp = await fetch(url);
    if (!resp.ok) return new Response("Proxy fetch failed", { status: 502 });

    const headers = new Headers();
    const ct = resp.headers.get("Content-Type") || "image/jpeg";
    headers.set("Content-Type", ct);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-store");

    return new Response(resp.body, { headers });
  } catch {
    return new Response("Proxy error", { status: 502 });
  }
}
