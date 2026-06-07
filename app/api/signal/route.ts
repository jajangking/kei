// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SignalData = any;

interface SignalMessage {
  type: "offer" | "answer" | "ice-candidate";
  data: SignalData;
  from: string;
  to: string;
}

const brainMessages: SignalMessage[] = [];
const remoteMessages: SignalMessage[] = [];

export async function POST(req: Request) {
  const body: SignalMessage = await req.json();
  if (body.to === "brain") {
    brainMessages.push(body);
  } else if (body.to === "remote") {
    remoteMessages.push(body);
  }
  return new Response("ok", { status: 200 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const for_ = url.searchParams.get("for") || "remote";
  const messages = for_ === "brain" ? brainMessages : remoteMessages;
  const batch = messages.splice(0);
  return Response.json(batch);
}

export const dynamic = "force-dynamic";
