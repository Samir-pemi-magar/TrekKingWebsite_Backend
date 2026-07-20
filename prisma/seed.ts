import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function seedUser(email: string | undefined, password: string | undefined, name: string, role: Role) {
  if (!email || !password) return null;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash, name, role } });
  console.log(`Seeded ${role.toLowerCase()}: ${email} (change this password after first login)`);
  return user;
}

async function main() {
  const admin = await seedUser(
    process.env.SEED_ADMIN_EMAIL,
    process.env.SEED_ADMIN_PASSWORD,
    "Head Admin",
    Role.ADMIN
  );
  if (!admin) {
    throw new Error("Missing SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD in your .env file");
  }

  const organizer = await seedUser(
    process.env.SEED_ORGANIZER_EMAIL,
    process.env.SEED_ORGANIZER_PASSWORD,
    process.env.SEED_ORGANIZER_NAME ?? "Demo Organizer",
    Role.ORGANIZER
  );
  if (!process.env.SEED_ORGANIZER_EMAIL || !process.env.SEED_ORGANIZER_PASSWORD) {
    console.log("Skipping organizer seed: SEED_ORGANIZER_EMAIL / SEED_ORGANIZER_PASSWORD not set");
  }

  const guide = await seedUser(
    process.env.SEED_GUIDE_EMAIL,
    process.env.SEED_GUIDE_PASSWORD,
    process.env.SEED_GUIDE_NAME ?? "Demo Guide",
    Role.GUIDE
  );
  if (!process.env.SEED_GUIDE_EMAIL || !process.env.SEED_GUIDE_PASSWORD) {
    console.log("Skipping guide seed: SEED_GUIDE_EMAIL / SEED_GUIDE_PASSWORD not set");
  }

  console.log("Seed complete — admin/organizer/guide only, no trips seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());