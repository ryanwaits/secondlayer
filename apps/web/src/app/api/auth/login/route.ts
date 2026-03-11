import { NextResponse } from "next/server";
import { apiRequest, ApiError } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    const data = await apiRequest("/api/auth/magic-link", {
      method: "POST",
      body: { email },
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
