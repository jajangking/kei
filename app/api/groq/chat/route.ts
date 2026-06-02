export const dynamic = "force-dynamic";
export const runtime = "edge";

export async function POST(req: Request) {
  const { messages, model = "llama-3.3-70b-versatile", apiKey } = await req.json();
  const GROQ_API_KEY = apiKey || process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return new Response("GROQ_API_KEY not configured", { status: 500 });
  }

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "Kamu adalah Kei, asisten robot yang membantu. Jawab dengan singkat, 1-2 kalimat dalam Bahasa Indonesia. Natural, gak kaku.",
        },
        ...messages,
      ],
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(`Groq API error: ${err}`, { status: 502 });
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
