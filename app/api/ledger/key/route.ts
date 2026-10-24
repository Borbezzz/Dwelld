import {ledgerPublicKey} from "@/lib/server/ledger";
export const runtime="nodejs";
/** Public: the Ed25519 key that signs every evidence seal, so anyone can check a seal themselves. */
export async function GET(){try{return Response.json({...ledgerPublicKey(),sealFormat:"sha256 of: dwelld-seal-v1, seq, inspectionId, roomId, sealedAt, filesRoot, prevSeal (newline-separated). filesRoot = sha256 of the sorted lines '<file sha256> <bytes> <ref>'."});}catch{return Response.json({error:"Ledger key is not configured"},{status:503});}}
