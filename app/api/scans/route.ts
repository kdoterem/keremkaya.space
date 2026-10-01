import { NextResponse } from "next/server";
import { getAllScanCollections } from "@/lib/scans";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getAllScanCollections());
}
