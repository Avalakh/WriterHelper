import { useEffect, useRef, useState } from 'react';

function NumberControl({label,value,min,max,step=1,change}:{label:string;value:number;min:number;max:number;step?:number;change:(value:number)=>void}){
 const [text,setText]=useState(String(Math.round(value)));
 const focused=useRef(false);
 useEffect(()=>{if(!focused.current)setText(String(Math.round(value)));},[value]);
 const commit=()=>{
  focused.current=false;
  const n=text.trim()===''?value:Number(text);
  const next=Number.isFinite(n)?Math.max(min,Math.min(max,Math.round(n))):value;
  setText(String(next));change(next);
 };
 return <label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={text}
  onFocus={()=>{focused.current=true;}}
  onChange={e=>{const input=e.target.value;setText(input);const n=Number(input);if(input.trim()!==''&&Number.isFinite(n)&&n>=min&&n<=max)change(n);}}
  onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}else if(e.key==='Escape'){setText(String(Math.round(value)));}}}/></label>;
}

export function PreviewControls({fields,width,zoom,change,setZoom}:{fields:Record<string,any>;width:number;zoom:number;change:(fields:Record<string,any>)=>void;setZoom:(zoom:number)=>void}){
 const number=(key:string,label:string,value:number,min:number,max:number)=><NumberControl key={key} label={label} value={value} min={min} max={max} change={n=>change({...fields,[key]:n,...(key==='width'?{fitWidth:false}:{})})}/>;
 return <div className="preview-controls" role="group" aria-label="Управление предпросмотром">
  {number('size','Шрифт, px',fields.size||17,10,40)}{number('heading','Заголовки, px',fields.heading||26,12,60)}
  <NumberControl label="Масштаб, %" value={zoom} min={25} max={250} step={10} change={setZoom}/>
  {number('width','Полотно: ширина',width,300,4000)}{number('height','Полотно: высота',fields.height||1123,400,6000)}
  <button title="A4, книжная ориентация: ширина 210 мм, высота 297 мм (794 × 1123 CSS px)" onClick={()=>change({...fields,width:794,height:1123,fitWidth:false})}>A4 · книжная</button>
  <button aria-pressed={fields.fitWidth===true} onClick={()=>change({...fields,fitWidth:true})}>На всю ширину</button>
 </div>;
}
