"use client";
import {useEffect,useState} from 'react';
/** Slim line loader. A percentage in the label ("… 42%") drives a determinate bar. */
export default function PixelLoader({label,startedAt,progress,showElapsed=true}:{label:string;startedAt?:number;progress?:{value:number;max:number;text:string};showElapsed?:boolean}) {
 const [initialStart]=useState(Date.now);const start=startedAt??initialStart;const [seconds,setSeconds]=useState(0);
 useEffect(()=>{if(!showElapsed)return;const tick=()=>setSeconds(Math.max(0,Math.floor((Date.now()-start)/1000)));tick();const id=setInterval(tick,1000);return()=>clearInterval(id)},[start,showElapsed]);
 const match=/(\d{1,3})\s*%/.exec(label);const percent=progress?Math.max(0,Math.min(100,100*progress.value/Math.max(1,progress.max))):match?Math.min(100,Number(match[1])):null;
 const text=label.replace(/\s*·?\s*\d{1,3}\s*%/,'');
 return <div className="line-loader" role="status" aria-live="polite"><div className="line-loader-head"><span className="line-loader-label">{text}</span><small>{progress?progress.text:percent!==null?`${percent}%`:''}{showElapsed?`${progress||percent!==null?' · ':''}${seconds}s`:''}</small></div><div className={`line-loader-track ${percent===null?'indeterminate':''}`} role={progress?"progressbar":undefined} aria-label={progress?label:undefined} aria-valuemin={progress?0:undefined} aria-valuemax={progress?.max} aria-valuenow={progress?.value} aria-valuetext={progress?.text} aria-hidden={progress?undefined:true}><span className="line-loader-bar" style={percent!==null?{width:`${percent}%`}:undefined}/></div></div>;
}
