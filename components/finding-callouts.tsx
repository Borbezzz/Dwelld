"use client";
import type { Finding } from '@/lib/types';

/** Leaders use image-relative coordinates so resizing keeps each label tied to its evidence. */
export default function FindingCallouts({findings,onSelect}:{findings:Finding[];onSelect:(id:string)=>void}) {
 const located=findings.filter(f=>f.kind==='damage'&&f.reviewStatus!=='rejected'&&(f.point||f.boundingBox));
 const entries=located.map(finding=>{
  const box=finding.boundingBox,point=finding.point||{x:box!.x+box!.width/2,y:box!.y+box!.height/2};
  const right=point.x<.5;
  const sameSide=located.filter(f=>{const x=f.point?.x??(f.boundingBox!.x+f.boundingBox!.width/2);return (x<.5)===right;});
  const row=sameSide.findIndex(f=>f.id===finding.id);
  return {finding,point,right,y:Math.min(.85,.08+row*.8/Math.max(1,sameSide.length))};
 });
 return <div className="finding-callouts"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{entries.map(({finding,point,right,y})=><g key={finding.id}><path d={`M ${point.x*100} ${point.y*100} L ${right?60:40} ${y*100+3}`} vectorEffect="non-scaling-stroke"/><circle cx={point.x*100} cy={point.y*100} r=".55"/></g>)}</svg>{entries.map(({finding,right,y})=><button type="button" key={finding.id} className="finding-callout" style={{left:right?'60%':'2%',top:`${y*100}%`}} onClick={event=>{event.stopPropagation();onSelect(finding.id);}} title={finding.description||finding.label}><b>{finding.label}</b><span>{finding.description}</span></button>)}</div>;
}
