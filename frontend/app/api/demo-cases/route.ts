import { demoCases } from "../../../lib/demo-cases";
import { modes } from "../../../lib/analysis-options";

export function GET() {
  return Response.json({ cases: demoCases, modes });
}
