import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Info, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { DataSnapshot } from './domain';
import { formatMoney, parseMoney } from './finance';
import { helpContent } from './help';
import type { HelpKey } from './help';

export const DataContext = createContext<DataSnapshot | null>(null);
export function useData() { const data = useContext(DataContext); if (!data) throw new Error('Notebook is still opening.'); return data; }
export const NavigationContext = createContext<{go:(path:string)=>void;setDirty:(value:boolean)=>void}>({go:()=>{},setDirty:()=>{}});
export function useGo() { return useContext(NavigationContext).go; }
export function useDirty(value:boolean) {
  const {setDirty} = useContext(NavigationContext);
  useEffect(()=>{setDirty(value); return ()=>setDirty(false);},[value,setDirty]);
}
export function AppLink({to,children,className='',...props}:{to:string;children:ReactNode;className?:string;title?:string;'aria-label'?:string}) {
  const go = useGo();
  return <a href={`#${to}`} className={className} {...props} onClick={e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go(to);}}}>{children}</a>;
}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref = useRef<HTMLDialogElement>(null); const id=useId();
  useEffect(()=>{const d=ref.current;d?.showModal();return()=>{d?.close();};},[]);
  return createPortal(<dialog ref={ref} className={`modal ${wide?'wide':''}`} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-inner"><div className="modal-head"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</div></dialog>,document.body);
}
export function InfoTip({topic}:{topic:HelpKey}) {
  const [open,setOpen]=useState(false);const ref=useRef<HTMLSpanElement>(null);const button=useRef<HTMLButtonElement>(null);const id=useId();
  useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);};},[open]);
  const help=helpContent[topic];
  return <span className="info-wrap" ref={ref}><button ref={button} type="button" className="info-button" aria-label={`About ${help.title}`} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)}><Info size={15}/></button>{open&&<span className="info-popover" role="dialog" aria-label={help.title} id={id}><strong>{help.title}</strong><span>{help.body}</span><button type="button" onClick={()=>{setOpen(false);button.current?.focus();}} className="text-button">Got it <Check size={13}/></button></span>}</span>;
}
export function Field({label,children,hint,error,topic}:{label:string;children:ReactNode;hint?:string;error?:string;topic?:HelpKey}) {
  return <div className="field"><div className="field-label">{label}{topic&&<InfoTip topic={topic}/>}</div>{children}{error?<small className="error" role="alert">{error}</small>:hint?<small className="muted">{hint}</small>:null}</div>;
}
export function MoneyInput({value,onValue,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'onChange'> & {value:string;onValue:(value:string)=>void}) {
  return <input {...props} type="text" inputMode="decimal" value={value} onChange={e=>onValue(e.target.value)} onBlur={e=>{try{const amount=parseMoney(e.target.value);if(amount!==null)onValue(formatMoney(amount).replace(/^₱\s*/,''));}catch{/* Keep invalid input visible for correction. */}props.onBlur?.(e);}}/>;
}
export function PageHeading({eyebrow,title,description,action,back}:{eyebrow?:string;title:string;description?:string;action?:ReactNode;back?:string}) {
  const nav=useNavigate();const go=useGo();
  return <div className="page-heading"><div>{back&&<button className="text-button back" onClick={()=>back==='history'?nav(-1):go(back)}><ArrowLeft size={16}/> Back</button>}{eyebrow&&<p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="muted">{description}</p>}</div>{action}</div>;
}
export function EmptyState({icon,title,children,action}:{icon:ReactNode;title:string;children:ReactNode;action?:ReactNode}) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{children}</p>{action}</div>;
}
export function Metric({label,value,sub,icon}:{label:string;value:string;sub?:string;icon?:ReactNode}) {
  return <div className="metric card"><div className="metric-label">{label}{icon}</div><div className="metric-value">{value}</div>{sub&&<small className="muted">{sub}</small>}</div>;
}
export function Avatar({name,large=false}:{name:string;large?:boolean}) {return <div className={`avatar ${large?'large':''}`} aria-hidden="true">{name.split(/\s+/).slice(0,2).map(n=>n[0]).join('').toUpperCase()}</div>;}
export function DateText({date}:{date:string|null}) {return <>{date?new Intl.DateTimeFormat('en-PH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Manila'}).format(new Date(`${date.slice(0,10)}T00:00:00+08:00`)):'—'}</>;}
export function RowLink({to,children}:{to:string;children:ReactNode}) {return <AppLink to={to} className="list-row">{children}<ChevronRight className="row-chevron" size={17}/></AppLink>;}
export function DownloadLink({onClick,children}:{onClick:()=>void;children:ReactNode}) {return <button type="button" className="button secondary" onClick={onClick}>{children}<ArrowUpRight size={16}/></button>;}
export function ErrorMessage({message}:{message:string}) {return message?<div className="notice danger" role="alert">{message}</div>:null;}
export function message(error:unknown) {return error instanceof Error?error.message:'That didn’t save. Please try again.';}
export function downloadText(text:string,name:string,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
