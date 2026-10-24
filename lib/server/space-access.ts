import {ObjectId} from "mongodb";
import {getDb} from "./db";
import {AccessError} from "./access";
/** Read-only collaboration permission. Never use this helper to authorize deletes or editing another user's observations. */
export async function canReadRoom(room:{_id:ObjectId;ownerId:string;spaceId?:ObjectId},userId:string){
 if(room.ownerId===userId)return true;
 if(!room.spaceId)return false;
 const db=await getDb();
 return !!await db.collection("spaceMembers").findOne({spaceId:room.spaceId,userId},{projection:{_id:1}});
}
export async function requireReadableInspection(id:ObjectId,userId:string){
 const db=await getDb(),inspection=await db.collection("inspections").findOne({_id:id});
 if(!inspection)throw new AccessError("Inspection not found",404);
 const room=await db.collection("rooms").findOne({_id:inspection.roomId});
 if(!room||!await canReadRoom(room as {_id:ObjectId;ownerId:string;spaceId?:ObjectId},userId))throw new AccessError("Inspection not found",404);
 return inspection;
}
