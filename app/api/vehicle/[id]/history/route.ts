import { createServerSupabase } from "@/lib/supabase-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const vehicleId = parseInt(id);

  if (isNaN(vehicleId)) {
    return Response.json({ error: "Invalid vehicle ID" }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  try {
    const { data, error } = await supabase
      .from("inventory_events")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("event_date", { ascending: true });

    if (error) {
      console.error("Supabase error:", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ events: data || [] }, { status: 200 });
  } catch (err) {
    console.error("Vehicle history error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
