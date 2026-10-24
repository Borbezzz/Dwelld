import {project,axes,origin,type V3} from '../server/projection';
export type VisiblePose={transform:number[];intrinsics:number[];width:number;height:number};
export type VisibleElement={id:string;category:string;dimensions:number[];transform:number[]};
export type ElementView={elementId:string;category:string;box:{x:number;y:number;width:number;height:number};area:number};
export type VisibilityInterval={startSeconds:number;endSeconds:number};
/** Where a furniture piece sits in this photo, if it is clearly in view. */
export function elementInView(e: VisibleElement, pose: VisiblePose): ElementView | null {
  const [ax, ay, az] = axes(e.transform), o = origin(e.transform), h = e.dimensions.map(v => Math.max(v, .02) / 2);
  const pts: { x: number; y: number }[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p: V3 = [0, 1, 2].map(i => o[i] + ax[i] * sx * h[0] + ay[i] * sy * h[1] + az[i] * sz * h[2]) as V3;
    const q = project(p, pose); if (q) pts.push(q);
  }
  // One edge may cross the camera plane (a close look at a door or tabletop). Two missing edges is not a usable view.
  if (pts.length < 6) return null;
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x)), y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const cx0 = Math.max(0, x0), cx1 = Math.min(1, x1), cy0 = Math.max(0, y0), cy1 = Math.min(1, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return null;
  const visible = (cx1 - cx0) * (cy1 - cy0), full = (x1 - x0) * (y1 - y0);
  if (visible < .03 || visible / full < .55) return null; // too small, or mostly out of frame
  const pad = .04;
  const box = { x: Math.max(0, cx0 - pad), y: Math.max(0, cy0 - pad), width: 0, height: 0 };
  box.width = Math.min(1, cx1 + pad) - box.x; box.height = Math.min(1, cy1 + pad) - box.y;
  return { elementId: e.id, category: e.category, box, area: visible };
}


/** Sample-supported appearance windows. A gap in observations splits a window. */
export function visibilityIntervals(times:number[],endSeconds:number,maxGap=1.5):VisibilityInterval[]{
 const sorted=[...new Set(times.filter(t=>Number.isFinite(t)&&t>=0&&t<=endSeconds))].sort((a,b)=>a-b),out:VisibilityInterval[]=[];
 for(const t of sorted){const last=out.at(-1);if(last&&t-last.endSeconds<=maxGap)last.endSeconds=t;else out.push({startSeconds:t,endSeconds:t});}
 return out.map(r=>({...r,endSeconds:Math.min(endSeconds,r.endSeconds+1/30)}));
}
export function elementVisibility(element:VisibleElement,frames:(VisiblePose&{timestamp:number})[],endSeconds:number){
 return visibilityIntervals(frames.filter(f=>elementInView(element,f)).map(f=>f.timestamp),endSeconds);
}
export function clipVisibility(ranges:VisibilityInterval[],start:number,end:number){
 return ranges.filter(r=>r.endSeconds>start&&r.startSeconds<end).map(r=>({startSeconds:Math.max(start,r.startSeconds)-start,endSeconds:Math.min(end,r.endSeconds)-start}));
}
