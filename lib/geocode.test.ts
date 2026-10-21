import { describe, expect, it } from "vitest";
import { placeFromPhoton } from "./geocode";

describe("placeFromPhoton", () => {
  it("uses the name with area and city as detail", () => {
    expect(
      placeFromPhoton({
        geometry: { coordinates: [73.874, 18.528] },
        properties: { name: "Pune Junction", street: "Station Road", district: "Agarkar Nagar", city: "Pune" },
      }),
    ).toEqual({ label: "Pune Junction", detail: "Station Road, Agarkar Nagar, Pune", lat: 18.528, lon: 73.874 });
  });
  it("falls back to the street when there is no name", () => {
    const p = placeFromPhoton({
      geometry: { coordinates: [73.84, 18.52] },
      properties: { street: "Fergusson College Road", city: "Pune" },
    });
    expect(p.label).toBe("Fergusson College Road");
    expect(p.detail).toBe("Pune");
  });
});
