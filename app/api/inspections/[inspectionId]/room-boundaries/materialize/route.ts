import {ObjectId} from "mongodb";
import {NextResponse} from "next/server";
import {getClientPromise,getDb,parseObjectId} from "@/lib/server/db";
import {requireUser} from "@/lib/server/access";
import {canReadRoom} from "@/lib/server/space-access";
import {errorResponse} from "@/lib/server/api-error";
import type {RoomBoundary} from "@/lib/spatial/room-boundaries";
export const runtime="nodejs";
type C={params:Promise<{inspectionId:string}>};
/** Materialize reviewed room boundaries without duplicating any media or rewriting the original scan. */
export async function POST(request:Request,{params}:C){try{
 const user=await requireUser(request),id=parseObjectId((await params).inspectionId),db=await getDb();
 if(!id)return NextResponse.json({error:"Inspection not found"},{status:404});
 const inspection=await db.collection("inspections").findOne({_id:id,ownerId:user.id});
 if(!inspection)return NextResponse.json({error:"Only the capture creator can split this scan"},{status:403});
 const room=await db.collection("rooms").findOne({_id:inspection.roomId});
 if(!room||!room.spaceId||!await canReadRoom(room as never,user.id))return NextResponse.json({error:"Put this room inside a Space before creating room sections"},{status:409});
 const space=await db.collection("spaces").findOne({_id:room.spaceId});if(!space)return NextResponse.json({error:"Space not found"},{status:404});
 const capture=await db.collection("spatialCaptures").findOne({inspectionId:id});
 if(!capture)return NextResponse.json({error:"A saved LiDAR capture is required"},{status:409});
 if(capture.roomSplitFinalizedAt){
  const saved=await db.collection("roomScanSegments").find({sourceInspectionId:id}).sort({startTime:1}).toArray();
  return NextResponse.json({rooms:saved.map(s=>({id:String(s.roomId),startTime:s.startTime,endTime:s.endTime})),alreadySaved:true});
 }
 const confirmed=(capture.roomBoundaries as RoomBoundary[]|undefined||[]).filter(b=>b.status==="confirmed").sort((a,b)=>a.timestamp-b.timestamp);
 if(!confirmed.length)return NextResponse.json({error:"Confirm at least one detected doorway first"},{status:409});
 const lastFrame=Math.max(0,...capture.manifest.frames.map((f:{timestamp:number})=>f.timestamp));
 const cuts=confirmed.map(b=>b.timestamp).filter((t:number)=>Number.isFinite(t)&&t>0&&t<lastFrame);
 if(cuts.length!==confirmed.length||cuts.some((t:number,i:number)=>i>0&&t-cuts[i-1]<1))return NextResponse.json({error:"Doorway timestamps overlap or fall outside the capture"},{status:409});
 await db.collection("roomScanSegments").createIndex({sourceInspectionId:1,roomId:1},{unique:true});
 const now=new Date(),newRooms=confirmed.map((b,index)=>({_id:new ObjectId(),ownerId:space.ownerId,createdBy:user.id,spaceId:space._id,name:b.label||`Room ${index+2}`,createdAt:now,sourceInspectionId:id,sourceBoundaryId:b.id}));
 const allIds=[room._id,...newRooms.map(r=>r._id)];
 const segments=allIds.map((roomId,index)=>({_id:new ObjectId(),sourceInspectionId:id,roomId,spaceId:space._id,ownerId:user.id,startTime:index===0?0:cuts[index-1],endTime:index<cuts.length?cuts[index]:lastFrame+0.001,createdAt:now}));
 const session=(await getClientPromise()).startSession();
 try{await session.withTransaction(async()=>{
  const claim=await db.collection("spatialCaptures").updateOne({_id:capture._id,roomSplitFinalizedAt:{$exists:false}},{$set:{roomSplitFinalizedAt:now,roomSplitSpaceId:space._id}},{session});
  if(!claim.modifiedCount)throw new Error("Room sections have already been created. Reload this inspection.");
  await db.collection("rooms").insertMany(newRooms,{session});
  await db.collection("roomScanSegments").insertMany(segments,{session});
 });}finally{await session.endSession();}
 return NextResponse.json({spaceId:String(space._id),rooms:segments.map((s,index)=>({id:String(s.roomId),name:index===0?room.name:newRooms[index-1].name,startTime:s.startTime,endTime:s.endTime}))},{status:201});
 }catch(e){return errorResponse(e,"room.boundaries.materialize")}}
