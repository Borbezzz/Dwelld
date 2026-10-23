#!/usr/bin/env node
/** Explicit administrator migration. Never run by the app or on sign-up. */
const {MongoClient,ObjectId}=require('mongodb');
const args=process.argv.slice(2);const allowed=new Set(['--owner-id','--room-id','--apply','--help']);
function value(flag){const i=args.indexOf(flag);return i<0?null:args[i+1];}
function usage(){console.log('Usage: node --env-file=.env --env-file=.env.local scripts/assign-legacy-owner.cjs --owner-id <existing-user-id> [--room-id <legacy-room-id>] [--apply]\nDry-run is the default. Only a trusted administrator should run --apply after auditing the listed legacy rooms.');}
(async()=>{if(args.includes('--help')){usage();return;}for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('Unknown argument');if(['--owner-id','--room-id'].includes(args[i]))i++;}const ownerId=value('--owner-id'),roomId=value('--room-id');if(!ownerId||!/^[a-f0-9]{24}$/i.test(ownerId))throw Error('An existing MongoDB auth user ID is required via --owner-id');if(roomId&&!/^[a-f0-9]{24}$/i.test(roomId))throw Error('Invalid --room-id');
 const c=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});await c.connect();const db=c.db(process.env.MONGODB_DB||'dwelld');try{
 const user=await db.collection('user').findOne({_id:new ObjectId(ownerId)});if(!user)throw Error('Owner user does not exist');const canonicalOwner=String(user._id),session=c.startSession();try{await session.withTransaction(async()=>{
 const rooms=await db.collection('rooms').find({ownerId:null,...(roomId?{_id:new ObjectId(roomId)}:{})},{session,projection:{_id:1}}).toArray();if(roomId&&!rooms.length)throw Error('Room not found or already owned');const roomIds=rooms.map(r=>r._id);
 // Do not bridge legacy data to existing owned records, even under this requested owner.
 if(await db.collection('inspections').countDocuments({roomId:{$in:roomIds},ownerId:{$ne:null}},{session}))throw Error('Legacy rooms contain already-owned inspections; audit and migrate separately');
 const inspections=await db.collection('inspections').find({roomId:{$in:roomIds},ownerId:null},{session}).toArray(),inspectionIds=inspections.map(i=>i._id);
 if(await db.collection('findings').countDocuments({inspectionId:{$in:inspectionIds},ownerId:{$ne:null}},{session}))throw Error('Legacy inspections contain already-owned findings; audit separately');
 const findings=await db.collection('findings').find({inspectionId:{$in:inspectionIds},ownerId:null},{session}).toArray();
 const refs=[...new Set([...inspections.map(i=>i.sourceUrl),...findings.map(f=>f.evidenceFrameUrl)].filter(r=>typeof r==='string'&&/^gridfs:[a-f0-9]{24}$/.test(r)))],mediaIds=refs.map(r=>new ObjectId(r.slice(7)));
 if(await db.collection('media.files').countDocuments({_id:{$in:mediaIds},'metadata.ownerId':{$nin:[null,canonicalOwner]}},{session}))throw Error('Evidence is owned by another user; migration refused');
 const plan={mode:args.includes('--apply')?'apply':'dry-run',rooms:roomIds.map(String),inspections:inspectionIds.length,findings:findings.length,referencedMedia:mediaIds.length};console.log(JSON.stringify(plan));
 if(!args.includes('--apply'))return;
 const audit={at:new Date(),ownerId:canonicalOwner,operation:'explicit-legacy-owner-assignment'};
 await db.collection('rooms').updateMany({_id:{$in:roomIds},ownerId:null},{$set:{ownerId:canonicalOwner,ownershipMigration:audit}},{session});
 await db.collection('inspections').updateMany({_id:{$in:inspectionIds},ownerId:null},{$set:{ownerId:canonicalOwner,ownershipMigration:audit}},{session});
 await db.collection('findings').updateMany({inspectionId:{$in:inspectionIds},ownerId:null},{$set:{ownerId:canonicalOwner,ownershipMigration:audit}},{session});
 await db.collection('media.files').updateMany({_id:{$in:mediaIds},'metadata.ownerId':null},{$set:{'metadata.ownerId':canonicalOwner}},{session});
 await db.collection('mediaUploads').updateMany({url:{$in:refs},ownerId:null},{$set:{ownerId:canonicalOwner}},{session});
 await db.collection('ownershipMigrations').insertOne({...audit,roomIds,inspectionIds,counts:plan},{session});
 });}finally{await session.endSession();}
 }finally{await c.close();}
})().catch(e=>{const known=/^(Unknown argument|An existing|Invalid --|Owner user|Room not found|Legacy |Evidence is owned)/.test(e.message||'');console.error(known?e.message:'Migration failed; check database access and permissions. No credentials were logged.');process.exitCode=1;});
