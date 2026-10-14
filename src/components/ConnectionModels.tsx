import {useEffect,useState} from 'react';
import {api} from '../api';

function ModelPicker({label,value,models,change,review=false,primary=false}:{label:string;value:string;models:string[];change:(v:string)=>void;review?:boolean;primary?:boolean}){
 const [manual,setManual]=useState(false);
 return <div className="field"><label>{label}<select aria-label={label} value={value||''} onChange={e=>change(e.target.value)}>
  <option value="">{primary?'Не назначена':review?'Та же модель, что для генерации':'Выберите модель'}</option>
  {value&&!models.includes(value)&&<option value={value}>{value} (вне загруженного списка)</option>}
  {models.map(model=><option key={model} value={model}>{model}</option>)}
 </select></label><button type="button" aria-expanded={manual} onClick={()=>setManual(!manual)}>{manual?'Скрыть ручной ввод':'Указать вручную'} · {primary?'основная модель':review?'модель проверки':'модель генерации'}</button>
 {manual&&<label>Идентификатор {primary?'основной модели':review?'модели проверки':'модели генерации'}<input aria-label={`Идентификатор ${primary?'основной модели':review?'модели проверки':'модели генерации'}`} value={value||''} onChange={e=>change(e.target.value)}/></label>}
 </div>;
}

export function ConnectionModels({id,kind,canLoad,model,reviewModel,primaryModel,change,refresh=0}:{id?:string;kind:string;canLoad:boolean;model:string;reviewModel:string;primaryModel?:string;change:(field:'model'|'reviewModel'|'primaryModel',v:string)=>void;refresh?:number}){
 const [models,setModels]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const supported=['api','openai'].includes(kind);
 useEffect(()=>{
  if(!id||!canLoad||!supported)return;
  let active=true;setBusy(true);setError('');
  api('models',{id}).then(value=>{if(active)setModels([...new Set<string>((Array.isArray(value)?value:[]).filter((v:unknown)=>typeof v==='string'&&v.trim()))]);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[id,kind,canLoad,revision,refresh]);
 return <section aria-label="Выбор моделей">
  <ModelPicker label="Основная модель" value={primaryModel||''} models={models} change={v=>change('primaryModel',v)} primary/><p className="muted">Основная модель этого подключения будет подставляться во все новые запросы. Другую модель можно выбрать для отдельной операции.</p><ModelPicker label="Модель генерации" value={model} models={models} change={v=>change('model',v)}/>
  <ModelPicker label="Модель проверки (пусто — та же)" value={reviewModel} models={models} change={v=>change('reviewModel',v)} review/>
  {supported&&<button disabled={!id||!canLoad||busy} onClick={()=>setRevision(n=>n+1)}>{busy?'Загрузка моделей…':'Получить модели'}</button>}
  {error&&<p role="alert">Не удалось получить модели: {error}. Повторите запрос или укажите идентификатор вручную.</p>}
  {!supported?<p className="muted">Исполнитель не предоставляет список моделей. Укажите идентификаторы вручную.</p>:!id||!canLoad?<p className="muted">Сохраните параметры подключения, чтобы загрузить доступные модели.</p>:!busy&&!error&&!models.length?<p className="muted">Подключение вернуло пустой список моделей.</p>:null}
 </section>;
}
