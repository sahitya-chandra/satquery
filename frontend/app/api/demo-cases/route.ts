import { demoCases, modes } from "../../../lib/demo-cases";

export function GET() {
  return Response.json({ cases: demoCases, modes });
}
