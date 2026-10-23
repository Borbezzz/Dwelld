import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { nextCookies } from "better-auth/next-js";
import { getClientPromise } from "@/lib/server/db";

let cached: Awaited<ReturnType<typeof createAuth>> | undefined;
async function createAuth() {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error("AUTH_NOT_CONFIGURED");
  const client = await getClientPromise();
  const db = client.db(process.env.MONGODB_DB || "dwelld");
  await Promise.all([
    db.collection("user").createIndex({email:1},{unique:true}),
    db.collection("session").createIndex({token:1},{unique:true}),
    db.collection("session").createIndex({expiresAt:1},{expireAfterSeconds:0}),
    db.collection("account").createIndex({providerId:1,accountId:1},{unique:true}),
  ]);
  return betterAuth({
    appName: "Dwelld", secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: mongodbAdapter(db, { client }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 50 },
    session: { expiresIn: 60*60*24*7, updateAge: 60*60*24 },
    plugins: [nextCookies()],
  });
}
export async function getAuth() { return cached ??= await createAuth(); }
