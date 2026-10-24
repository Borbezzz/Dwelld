import type {Finding} from '@/lib/types';
export type VideoMarker=Pick<Finding,'id'|'kind'|'label'|'boundingBox'|'point'>;
/** Limit untrusted peer metadata and reject coordinates outside the actual camera surface. */
export function parseVideoMarkers(value:unknown):VideoMarker[]{
 if(!Array.isArray(value))return [];
 return value.slice(0,100).flatMap<VideoMarker>(v=>{
  if(!v||typeof v.id!=='string'||v.id.length>100||!['object','damage'].includes(v.kind)||typeof v.label!=='string'||v.label.length>200)return [];
  const b=v.boundingBox,p=v.point;
  if(b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)&&b.x>=0&&b.y>=0&&b.width>0&&b.height>0&&b.x+b.width<=1.00001&&b.y+b.height<=1.00001)return [{id:v.id,kind:v.kind,label:v.label,boundingBox:b}];
  if(p&&[p.x,p.y].every(Number.isFinite)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)return [{id:v.id,kind:v.kind,label:v.label,point:p}];
  return [];
 });
}
