/** Bound bytes while reading, before JSON parsing or buffering a full request. */
export class RequestBodyError extends Error {
 constructor(message:string,public status=413){super(message);this.name="RequestBodyError";}
}
export async function readTextBody(request:Request,maxBytes=64*1024):Promise<string>{
 const declared=Number(request.headers.get("content-length"));
 if(Number.isFinite(declared)&&declared>maxBytes)throw new RequestBodyError("Request body is too large");
 if(!request.body)return "";
 const reader=request.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new RequestBodyError("Request body is too large");}text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}
}
export async function readJsonBody(request:Request,maxBytes=64*1024){
 if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))throw new RequestBodyError("Content-Type must be application/json",415);
 const value=JSON.parse(await readTextBody(request,maxBytes));
 if(!value||typeof value!=="object"||Array.isArray(value))throw new RequestBodyError("Request body must be a JSON object",400);
 return value;
}
