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
  const base=right ? .08 : .2;
  const y=Math.min(.85,base+row*(.85-base)/Math.max(1,sameSide.length)),endX=right?60:40,endY=y*100+3,startX=point.x*100,startY=point.y*100,direction=endX>=startX?1:-1;
  const lead=Math.min(5,Math.abs(endX-startX)/3);
  const bendY=endY+(startY>=endY?1:-1)*Math.min(4,Math.abs(startY-endY)/2);
  const path=`M ${startX} ${startY} H ${startX+direction*lead} V ${bendY} L ${startX+direction*lead*2} ${endY} H ${endX}`;
  return {finding,point,right,y,path,endX,endY};
 });
 return <div className="finding-callouts"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{entries.map(({finding,point,path,endX,endY})=><g key={finding.id}><path className="finding-leader" d={path} vectorEffect="non-scaling-stroke"/><path className="finding-leader-terminal" d={`M ${endX} ${endY-.65} V ${endY+.65}`} vectorEffect="non-scaling-stroke"/><rect className="finding-leader-node" x={point.x*100-.45} y={point.y*100-.45} width=".9" height=".9" vectorEffect="non-scaling-stroke"/></g>)}</svg>{entries.map(({finding,right,y})=><button type="button" key={finding.id} className="finding-callout" style={{left:right?'60%':undefined,right:right?undefined:'60%',top:`${y*100}%`}} onClick={event=>{event.stopPropagation();onSelect(finding.id);}} title={finding.description||finding.label}><b>{finding.label}</b><span>{finding.description}</span></button>)}</div>;
}
