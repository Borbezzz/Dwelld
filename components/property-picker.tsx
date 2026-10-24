"use client";
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import type {Space} from '@/lib/types';

/** Site-styled property selector; focus stays on the combobox while its list is open. */
export default function PropertyPicker({roomName,value,spaces,disabled,onChange}:{roomName:string;value:string;spaces:Space[];disabled:boolean;onChange:(value:string)=>void}){
 const id=useId(),root=useRef<HTMLSpanElement>(null),button=useRef<HTMLButtonElement>(null),list=useRef<HTMLSpanElement>(null);
 const [open,setOpen]=useState(false),[active,setActive]=useState(0),[above,setAbove]=useState(false);
 const typed=useRef({text:'',at:0}),options=[{id:'',name:'Ungrouped'},...spaces];
 const selected=Math.max(0,options.findIndex(o=>o.id===value)),expanded=open&&!disabled;
 function show(index=selected){const rect=button.current?.getBoundingClientRect();setAbove(!!rect&&window.innerHeight-rect.bottom<Math.min(260,options.length*44+16)&&rect.top>260);setActive(index);setOpen(true);}
 function choose(index:number){const option=options[index];if(!option||disabled)return;setOpen(false);button.current?.focus();if(option.id!==value)onChange(option.id);}
 useEffect(()=>{if(!expanded)return;function outside(e:PointerEvent){if(!root.current?.contains(e.target as Node))setOpen(false);}document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[expanded]);
 useEffect(()=>{if(expanded)(list.current?.children[active] as HTMLElement|undefined)?.scrollIntoView({block:'nearest'});},[expanded,active]);
 function key(e:KeyboardEvent<HTMLButtonElement>){
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?options.length-1:expanded?(active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length:selected;if(expanded)setActive(next);else show(next);}
  else if(e.key==='Escape'){e.preventDefault();setOpen(false);}
  else if((e.key==='Enter'||e.key===' ')&&expanded){e.preventDefault();choose(active);}
  else if(e.key==='Tab')setOpen(false);
  else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key!==' '){e.preventDefault();const now=Date.now(),text=now-typed.current.at>700?e.key:typed.current.text+e.key;typed.current={text:text.toLowerCase(),at:now};const match=options.findIndex(o=>o.name.toLowerCase().startsWith(typed.current.text));if(match>=0){if(expanded)setActive(match);else show(match);}}
 }
 return <span ref={root} className="room-space-picker" onClick={e=>e.stopPropagation()} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <button ref={button} type="button" role="combobox" className="room-space-select" aria-label={`Property for ${roomName}`} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded?id:undefined} aria-activedescendant={expanded?`${id}-${active}`:undefined} disabled={disabled} onKeyDown={key} onClick={()=>expanded?setOpen(false):show()}><span>{options[selected].name}</span><ChevronDown size={16} aria-hidden="true"/></button>
  {expanded&&<span ref={list} id={id} role="listbox" aria-label={`Property for ${roomName}`} className={`room-space-menu${above?' opens-above':''}`}>{options.map((option,index)=><span id={`${id}-${index}`} role="option" aria-selected={option.id===value} key={option.id} className={`room-space-option${active===index?' is-active':''}`} onPointerMove={()=>setActive(index)} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(index)}><span>{option.name}</span>{option.id===value&&<Check size={15} aria-hidden="true"/>}</span>)}</span>}
 </span>;
}
