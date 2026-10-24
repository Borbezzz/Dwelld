import {NextResponse} from "next/server";
import {getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {requireReadableInspection} from "@/lib/server/space-access";
import {readJsonBody} from "@/lib/server/request-body";
import {errorResponse} from "@/lib/server/api-error";
import {suggestRoomBoundaries} from "@/lib/spatial/room-boundaries";
import type {RoomBoundary} from "@/lib/spatial/room-boundaries";
export const runtime="nodejs";
type C={params:Promise<{inspectionId:string}>};
export async function GET(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).inspectionId);
 if(!id)return NextResponse.json({error:"Inspection not found"},{status:404});
 await requireReadableInspection(id,user.id);const db=await getDb();
 const capture=await db.collection("spatialCaptures").findOne({inspectionId:id},{projection:{manifest:1,roomBoundaries:1,roomSplitFinalizedAt:1,roomSplitSpaceId:1}});
 if(!capture)return NextResponse.json({boundaries:[]});
 return NextResponse.json({boundaries:capture.roomBoundaries??suggestRoomBoundaries(capture.manifest),materialized:!!capture.roomSplitFinalizedAt,spaceId:capture.roomSplitSpaceId?String(capture.roomSplitSpaceId):null},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return errorResponse(e,"room.boundaries.read")}}
export async function PATCH(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).inspectionId);
 if(!id)return NextResponse.json({error:"Inspection not found"},{status:404});
 const db=await getDb(),inspection=await db.collection("inspections").findOne({_id:id,ownerId:user.id});
 if(!inspection)return NextResponse.json({error:"Only the scan creator can approve its room boundaries"},{status:403});
 const b=await readJsonBody(request,2048);
 if(typeof b.id!=="string"||!["confirmed","rejected"].includes(String(b.status)))return NextResponse.json({error:"Invalid boundary review"},{status:400});
 if(b.label!==undefined&&(typeof b.label!=="string"||!b.label.trim()||b.label.trim().length>80))return NextResponse.json({error:"Room name must be 1–80 characters"},{status:400});
 const capture=await db.collection("spatialCaptures").findOne({inspectionId:id},{projection:{manifest:1,roomBoundaries:1}});
 if(!capture)return NextResponse.json({error:"Capture not found"},{status:404});
 if(capture.roomSplitFinalizedAt)return NextResponse.json({error:"Rooms have already been created for this scan"},{status:409});
 const boundaries=(capture.roomBoundaries??suggestRoomBoundaries(capture.manifest)) as RoomBoundary[];
 const index=boundaries.findIndex(x=>x.id===b.id);
 if(index<0)return NextResponse.json({error:"Boundary not found"},{status:404});
 boundaries[index]={...boundaries[index],status:b.status==="confirmed"?"confirmed":"rejected",label:typeof b.label==="string"?b.label.trim():boundaries[index].label};
 const result=await db.collection("spatialCaptures").updateOne({_id:capture._id,...(capture.roomBoundaries?{roomBoundaries:capture.roomBoundaries}:{roomBoundaries:{$exists:false}})},{$set:{roomBoundaries:boundaries,roomBoundariesUpdatedAt:new Date()}});
 if(!result.modifiedCount)return NextResponse.json({error:"Boundaries changed; reload and retry"},{status:409});
 return NextResponse.json({boundaries});
 }catch(e){return errorResponse(e,"room.boundaries.review")}}
