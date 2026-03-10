import { NextResponse } from "next/server";
import { getAllAnswers } from "@/lib/answers";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getAllAnswers());
}
