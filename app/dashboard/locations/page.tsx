import LocationsMap from "./LocationsMap";

export default function LocationsPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-white text-xl font-bold">Locations</h1>
        <p className="text-gray-400 text-sm mt-1">
          Track dealership positioning across the Las Vegas market.
        </p>
      </div>
      <LocationsMap />
    </div>
  );
}
