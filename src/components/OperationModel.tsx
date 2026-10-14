import {useEffect,useState} from 'react';
import {api} from '../api';
import type {Entity} from '../types';
export function OperationModel({connection,value,change,busy=false}:{connection?:Entity;value:string;change:(model:string)=>void;busy?:boolean}){
 const [models,setModels]=useState<string[]>([]),[manual,setManual]=useState(false);
 const selected=value||connection?.primaryModel||connection?.model||'';
 useEffect(()=>{let active=true;setModels([]);if(connection&&['api','openai'].includes(connection.kind))api('models',{id:connection.id}).then(v=>{if(active)setModels([...new Set<string>((Array.isArray(v)?v:[]).filter(m=>typeof m==='string'&&m))]);}).catch(()=>{});return()=>{active=false;};},[connection?.id]);
 return <div className="field"><label>Модель для запроса<select aria-label="Модель для запроса" disabled={busy||!connection} value={selected} onChange={e=>change(e.target.value)}>
 <option value="">Выберите модель</option>{selected&&!models.includes(selected)&&<option value={selected}>{selected}</option>}{models.map(m=><option key={m} value={m}>{m}{m===connection?.primaryModel?' · основная':''}</option>)}</select></label>
 <button type="button" disabled={busy} onClick={()=>setManual(!manual)}>Указать модель запроса вручную</button>{manual&&<input aria-label="Идентификатор модели запроса" disabled={busy} value={selected} onChange={e=>change(e.target.value)}/>}</div>;
}
