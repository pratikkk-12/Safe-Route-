// Loads .env.local for standalone scripts (Next.js does this itself for the app).
import { config } from "dotenv";

config({ path: ".env.local" });
