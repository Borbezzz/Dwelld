"use client";
import {useEffect,useState} from 'react';
/** Slim line loader. A percentage in the label ("… 42%") drives a determinate bar. */
export default function PixelLoader({label,startedAt}:{label:string;startedAt?:number}) {
 const [initialStart]=useState(Date.now);const start=startedAt??initialStart;const [seconds,setSeconds]=useState(0);
 useEffect(()=>{const tick=()=>setSeconds(Math.max(0,Math.floor((Date.now()-start)/1000)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[start]);
 const match=/(\d{1,3})\s*%/.exec(label);const percent=match?Math.min(100,Number(match[1])):null;
 const text=label.replace(/\s*·?\s*\d{1,3}\s*%/,'');
 return <div className="line-loader" role="status" aria-live="polite"><div className="line-loader-head"><span className="line-loader-label">{text}</span><small>{percent!==null?`${percent}% · `:''}{seconds}s</small></div><div className={`line-loader-track ${percent===null?'indeterminate':''}`} aria-hidden><span className="line-loader-bar" style={percent!==null?{width:`${percent}%`}:undefined}/></div></div>;
}
