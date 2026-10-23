import {readJsonBody} from "@/lib/server/request-body";
import {getAuth} from "@/lib/auth";
import {errorResponse} from "@/lib/server/api-error";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(request:Request) { try {
 if(request.method==="POST"){const body=await readJsonBody(request);if(typeof body.name==="string"&&(!body.name.trim()||body.name.length>80))return Response.json({message:"Name must be between 1 and 80 characters"},{status:400});request=new Request(request,{body:JSON.stringify(body)});}
 return await (await getAuth()).handler(request); } catch(error) { return errorResponse(error,"auth"); } }
export {handle as GET,handle as POST};
