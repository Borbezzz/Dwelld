// Run with: node --env-file=.env --env-file=.env.local scripts/setup-search-indexes.cjs
// Creates or updates every Atlas Search / Vector Search index Dwelld uses on `findings`.
// The same definitions live in lib/server/search-pipelines.ts (also reachable from the
// search page's "Create indexes" button via POST /api/search/setup?action=indexes).
// Requires Atlas search-index management privileges. Does not print the URI.
const {MongoClient}=require('mongodb');
const autoModel=process.env.ATLAS_AUTO_EMBED_MODEL||'voyage-4';
const filters=[{type:'filter',path:'ownerId'},{type:'filter',path:'roomId'}];
const indexes=[
 {name:'findings_search',type:'search',definition:{mappings:{dynamic:false,fields:{label:{type:'string'},description:{type:'string'},damageType:{type:'string'},ownerId:{type:'token'},roomId:{type:'objectId'}}}}},
 {name:'findings_vector',type:'vectorSearch',definition:{fields:[{type:'vector',path:'embedding',numDimensions:768,similarity:'cosine'},...filters]}},
 // Automated Embedding: Atlas embeds `searchText` with a Voyage model on write and the query text at query time.
 {name:'findings_auto',type:'vectorSearch',definition:{fields:[{type:'autoEmbed',modality:'text',path:'searchText',model:autoModel},...filters]}},
 // Evidence photos embedded with Voyage voyage-multimodal-3.5 (1024-d), searched with text queries.
 {name:'findings_image',type:'vectorSearch',definition:{fields:[{type:'vector',path:'imageEmbedding',numDimensions:1024,similarity:'cosine'},...filters]}},
];
(async()=>{const client=new MongoClient(process.env.MONGODB_URI);try{await client.connect();const c=client.db(process.env.MONGODB_DB||'dwelld').collection('findings');const existing=await c.listSearchIndexes().toArray();
 for(const index of indexes){try{if(existing.some(i=>i.name===index.name))await c.updateSearchIndex(index.name,index.definition);else await c.createSearchIndex(index);console.log(index.name+': configuration submitted');}catch(e){console.error(index.name+': failed',e.message);process.exitCode=1;}}
 for(const i of await c.listSearchIndexes().toArray())console.log(i.name.padEnd(18),i.status,i.queryable?'queryable':'');
}catch(e){console.error('Search index setup failed',{name:e.name,code:e.code});process.exitCode=1;}finally{await client.close();}})();
