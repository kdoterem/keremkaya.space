import { NextResponse } from "next/server";
import { getMonthlyTextProfile } from "@/lib/posts";

export function GET() {
  const terrain = getMonthlyTextProfile();
  return NextResponse.json(terrain);
}
