import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { generateTripTranslations, generateItineraryDayTranslations } from "../models/trip.model.js";

async function main() {
  console.log("Fetching trips from database...");
  const trips = await prisma.trip.findMany({
    where: { deletedAt: null },
    include: { itinerary: true },
  });

  console.log(`Found ${trips.length} trip(s) in database.`);

  for (const trip of trips) {
    console.log(`Translating trip: "${trip.name}"...`);
    const results = await generateTripTranslations(trip.id, trip);
    console.log(`Trip translation results count: ${results.length}`);

    for (const day of trip.itinerary) {
      console.log(`Translating itinerary day ${day.dayNumber}: "${day.title}"...`);
      await generateItineraryDayTranslations(day.id, day);
    }
  }

  console.log("✅ All trip translations generated successfully!");
}

main()
  .catch((err) => {
    console.error("Error generating translations:", err);
  })
  .finally(() => {
    prisma.$disconnect();
  });
