import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const dealerId = parseInt(id);

  if (isNaN(dealerId)) {
    return Response.json({ error: "Invalid dealer ID" }, { status: 400 });
  }

  const url = new URL(request.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") || "7")));

  const supabase = await createServerSupabase();

  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - days);
  const thresholdStr = dateThreshold.toISOString().split("T")[0];

  try {
    const { data, error } = await supabase
      .from("inventory_snapshots")
      .select("snapshot_date, list_price")
      .eq("dealer_id", dealerId)
      .gte("snapshot_date", thresholdStr)
      .not("list_price", "is", null)
      .order("snapshot_date", { ascending: true });

    if (error) {
      console.error("Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return Response.json({ data: [] }, { status: 200 });
    }

    // Aggregate by date: average price per day
    const byDate = new Map<string, number[]>();
    data.forEach((row: { snapshot_date: string; list_price: number }) => {
      if (!byDate.has(row.snapshot_date)) {
        byDate.set(row.snapshot_date, []);
      }
      byDate.get(row.snapshot_date)!.push(row.list_price);
    });

    const result = Array.from(byDate.entries())
      .map(([date, prices]) => ({
        date,
        price: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({ data: result }, { status: 200 });
  } catch (err) {
    console.error("Price trend error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
