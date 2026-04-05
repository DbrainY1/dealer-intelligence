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
    // Fetch events
    const { data: events, error: eventsError } = await supabase
      .from("inventory_events")
      .select("*")
      .eq("vehicle_id", vehicleId)
      .order("event_date", { ascending: true });

    if (eventsError) {
      console.error("Supabase error:", eventsError);
      return Response.json({ error: eventsError.message }, { status: 500 });
    }

    // Fetch vehicle details
    const { data: vehicle, error: vehicleError } = await supabase
      .from("vehicles")
      .select("year, make, model, mileage")
      .eq("id", vehicleId)
      .limit(1)
      .single();

    if (vehicleError && vehicleError.code !== "PGRST116") {
      console.error("Vehicle lookup error:", vehicleError);
    }

    return Response.json(
      {
        events: events || [],
        vehicle: vehicle || { year: null, make: null, model: null, mileage: null },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Vehicle history error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
