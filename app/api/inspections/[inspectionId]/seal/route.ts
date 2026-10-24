import {NextResponse} from "next/server";
import {requireUser,requireOwnedInspection} from "@/lib/server/access";
import {requireReadableInspection} from "@/lib/server/space-access";
import {parseObjectId} from "@/lib/server/db";
import {errorResponse} from "@/lib/server/api-error";
import {sealInspection,verifyInspection} from "@/lib/server/ledger";
export const runtime="nodejs";export const dynamic="force-dynamic";export const maxDuration=120;
type Context={params:Promise<{inspectionId:string}>};
/** Anyone who can read the inspection (including a landlord it was shared with) can verify its seal. */
export async function GET(request:Request,{params}:Context){try{
 const user=await requireUser(request),id=parseObjectId((await params).inspectionId);if(!id)return NextResponse.json({error:"Inspection not found"},{status:404});
 await requireReadableInspection(id,user.id);
 return NextResponse.json(await verifyInspection(id),{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return errorResponse(e,"ledger.verify");}}
/** Seals evidence that has no seal yet, for example an inspection saved before sealing existed. Owner only. */
export async function POST(request:Request,{params}:Context){try{
 const user=await requireUser(request),inspection=await requireOwnedInspection((await params).inspectionId,user.id);
 const entry=await sealInspection(inspection._id);
 if(!entry)return NextResponse.json({error:"This inspection has no stored evidence files to seal yet"},{status:409});
 return NextResponse.json(await verifyInspection(inspection._id));
}catch(e){return errorResponse(e,"ledger.seal");}}
