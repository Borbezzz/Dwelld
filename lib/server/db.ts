import { MongoClient, ObjectId, type Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _dwelldMongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (global._dwelldMongoClientPromise) return global._dwelldMongoClientPromise;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MongoDB is unavailable: MONGODB_URI is not configured");
  const promise = new MongoClient(uri).connect().catch((error) => {
    global._dwelldMongoClientPromise = undefined;
    throw error;
  });
  global._dwelldMongoClientPromise = promise;
  return promise;
}

export async function getDb(): Promise<Db> {
  return (await getClientPromise()).db(process.env.MONGODB_DB || "dwelld");
}

export function parseObjectId(value: string): ObjectId | null {
  return ObjectId.isValid(value) && new ObjectId(value).toHexString() === value.toLowerCase()
    ? new ObjectId(value)
    : null;
}

export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection("rooms").createIndex({ createdAt: -1 }),
    db.collection("inspections").createIndex({ roomId: 1, createdAt: -1 }),
    db.collection("findings").createIndex({ inspectionId: 1, createdAt: 1 }),
    db.collection("findings").createIndex({ roomId: 1, reviewStatus: 1 }),
  ]);
}
