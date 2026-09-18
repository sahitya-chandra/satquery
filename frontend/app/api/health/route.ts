import { modelConfiguration } from "../../../lib/model-config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", backend: "nextjs", ai: modelConfiguration() }, { headers: { "Cache-Control": "no-store" } });
}
