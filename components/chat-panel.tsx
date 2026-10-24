"use client";
import {useEffect,useRef,useState,type ReactNode,type PointerEvent,type KeyboardEvent} from 'react';
import {ArrowUpRight,GripHorizontal,MessageSquare,Minus,PanelBottom,X} from 'lucide-react';

type Point={x:number;y:number};
/** One persistent chat surface. Hiding it never discards a conversation or interrupts a request. */
export default function ChatPanel({children,label,busy=false,className=''}:{children:ReactNode;label:string;busy?:boolean;className?:string}){
 const [state,setState]=useState<'open'|'minimized'|'closed'>('open'),[position,setPosition]=useState<Point|null>(null);
 const panel=useRef<HTMLElement>(null),drag=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null),opener=useRef<HTMLButtonElement>(null);
 function clamp(point:Point){const rect=panel.current?.getBoundingClientRect();return {x:Math.max(8,Math.min(point.x,window.innerWidth-(rect?.width||420)-8)),y:Math.max(8,Math.min(point.y,window.innerHeight-(rect?.height||60)-8))};}
 useEffect(()=>{const element=panel.current;if(!element)return;const fit=()=>setPosition(p=>p?clamp(p):p);const observer=new ResizeObserver(fit);observer.observe(element);window.addEventListener('resize',fit);return()=>{observer.disconnect();window.removeEventListener('resize',fit)}},[]);
 function start(e:PointerEvent<HTMLButtonElement>){if(e.button!==0)return;const rect=panel.current?.getBoundingClientRect();if(!rect)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};setPosition({x:rect.left,y:rect.top});}
 function move(e:PointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.id!==e.pointerId)return;setPosition(clamp({x:d.left+e.clientX-d.x,y:d.top+e.clientY-d.y}));}
 function keyboard(e:KeyboardEvent<HTMLButtonElement>){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();if(e.key==='Home'){setPosition(null);return}const rect=panel.current?.getBoundingClientRect();if(rect)setPosition(clamp({x:rect.left+(e.key==='ArrowRight'?24:e.key==='ArrowLeft'?-24:0),y:rect.top+(e.key==='ArrowDown'?24:e.key==='ArrowUp'?-24:0)}));}
 function hide(next:'closed'|'minimized'){setState(next);requestAnimationFrame(()=>opener.current?.focus())}
 return <aside ref={panel} className={`ask-records argon-window ${className}`} aria-label={label} data-state={state} data-floating={!!position} style={position?{left:position.x,top:position.y,right:'auto',bottom:'auto',transform:'none'}:undefined}>
 <button ref={opener} className="argon-launcher" hidden={state==='open'} onClick={()=>setState('open')} aria-label={state==='closed'?'Open Argon chat':'Restore Argon chat'}><MessageSquare size={16} aria-hidden="true"/><span>Argon{state==='minimized'?' · Resume':''}</span>{busy&&<span className="argon-busy-light" aria-label="Working"/>}<ArrowUpRight size={14} aria-hidden="true"/></button>
 <div className="argon-panel" hidden={state!=='open'}>
 <header className="argon-panel-header"><button type="button" className="argon-drag" aria-label="Move Argon chat; use arrow keys to move, Home to dock" onPointerDown={start} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} onKeyDown={keyboard}><GripHorizontal size={16} aria-hidden="true"/><span>Argon <small>{label}</small></span></button><div className="argon-window-actions"><button type="button" aria-label={position?'Dock Argon chat':'Pop out Argon chat'} title={position?'Dock':'Pop out'} onClick={()=>{if(position)setPosition(null);else {const rect=panel.current?.getBoundingClientRect();setPosition(clamp({x:Math.max(8,(rect?.left||0)-80),y:80}))}}}>{position?<PanelBottom size={15}/>:<ArrowUpRight size={15}/>}</button><button type="button" aria-label="Minimize Argon chat" title="Minimize" onClick={()=>hide('minimized')}><Minus size={15}/></button><button type="button" aria-label="Close Argon chat" title="Close" onClick={()=>hide('closed')}><X size={15}/></button></div></header>
 <div className="argon-panel-body">{children}</div></div></aside>;
}
