import { headers } from "next/headers";
import { ObjectId } from "mongodb";
import { getAuth } from "@/lib/auth";
import { getDb, parseObjectId } from "./db";
export class AccessError extends Error { constructor(message:string, public status=401) { super(message); this.name="AccessError"; } }
export async function requireUser(request?:Request) {
  const session = await (await getAuth()).api.getSession({headers: request?.headers || await headers()});
  if (!session) throw new AccessError("Sign in to access your room records.");
  if (request && !["GET","HEAD","OPTIONS"].includes(request.method)) {
    const origin=request.headers.get("origin");
    if(request.headers.get("sec-fetch-site")==="cross-site")throw new AccessError("Cross-site request rejected",403);
    if (origin && origin !== new URL(request.url).origin) throw new AccessError("Cross-origin request rejected",403);
  }
  return session.user;
}
export async function requireOwnedRoom(id:string|ObjectId, ownerId:string) {
  const _id=typeof id==="string"?parseObjectId(id):id;
  const doc=_id?await (await getDb()).collection("rooms").findOne({_id,ownerId}):null;
  if(!doc) throw new AccessError("Room not found",404);
  return doc;
}
export async function requireOwnedInspection(id:string|ObjectId, ownerId:string) {
  const _id=typeof id==="string"?parseObjectId(id):id;
  const doc=_id?await (await getDb()).collection("inspections").findOne({_id,ownerId}):null;
  if(!doc) throw new AccessError("Inspection not found",404);
  return doc;
}
