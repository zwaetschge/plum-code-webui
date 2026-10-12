import { useState } from 'react';
import { Button } from '@/components/ui/button';

type Model={id:string;name?:string};
export function NativeModelControls({agent,stand,onCommand}:{agent:string;stand:Record<string,unknown>;onCommand:(command:string)=>void}) {
  const models=(Array.isArray(stand.modelle)?stand.modelle:[]).map(item=>typeof item==='string'?{id:item}:item).filter((item):item is Model=>!!item&&typeof item==='object'&&typeof item.id==='string');
  const efforts=(Array.isArray(stand.aufwaende)?stand.aufwaende:[]).filter((item):item is string=>typeof item==='string');
  const [model,setModel]=useState(String(stand.modell ?? '')),[fallback,setFallback]=useState<string[]>((Array.isArray(stand.fallback)?stand.fallback:[]).filter((value):value is string=>typeof value==='string')),[effort,setEffort]=useState(String(stand.aufwand ?? 'standard')),[error,setError]=useState('');
  const maximum=Math.max(0,Math.min(10,Number(stand.fallback_max ?? 3)));
  const configurable=stand.einstellbar===true || stand.einstellbar==='true';
  if(!configurable)return <p className="text-xs text-muted-foreground">{typeof stand.hinweis==='string'?stand.hinweis:'Diese Rolle besitzt hier kein einstellbares Modell.'}</p>;
  return <form className="grid min-w-0 gap-3" onSubmit={event=>{
    event.preventDefault();setError('');
    if(!models.some(item=>item.id===model)){setError('Ein Modell aus dem bestätigten Katalog auswählen');return;}
    if(fallback.length>maximum || fallback.includes(model) || fallback.some(id=>!models.some(item=>item.id===id))){setError('Die Ersatzkette enthält ein ungültiges Modell oder überschreitet das Limit');return;}
    const suffix=stand.fallback_aenderbar!==false?` fallback ${fallback.length?fallback.join(','):'keiner'}`:'';
    onCommand(`!modell @${agent} ${model}${suffix}${efforts.length?` aufwand ${effort}`:''}`);
  }}>
    <label className="grid min-w-0 gap-1 text-sm">Hauptmodell<select aria-label="Hauptmodell" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={model} onChange={event=>{setModel(event.target.value);setFallback(previous=>previous.filter(id=>id!==event.target.value));}}><option value="">Modell auswählen</option>{model && !models.some(item=>item.id===model)&&<option value={model}>{model} · nicht im aktuellen Katalog</option>}{models.map(item=><option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></label>
    {stand.fallback_aenderbar!==false&&<fieldset className="space-y-2 text-sm"><legend>Ersatzkette · höchstens {maximum}</legend><ol className="list-decimal space-y-1 pl-5">{fallback.map(id=><li key={id}>{models.find(item=>item.id===id)?.name ?? id}<Button type="button" variant="ghost" size="sm" onClick={()=>setFallback(previous=>previous.filter(value=>value!==id))}>Entfernen</Button></li>)}</ol><select aria-label="Ersatzmodell hinzufügen" className="w-full rounded-md border bg-background p-2" value="" disabled={fallback.length>=maximum} onChange={event=>{if(event.target.value)setFallback(previous=>[...previous,event.target.value]);}}><option value="">Ersatzmodell hinzufügen</option>{models.filter(item=>item.id!==model&&!fallback.includes(item.id)).map(item=><option key={item.id} value={item.id}>{item.name ?? item.id}</option>)}</select></fieldset>}
    {!!efforts.length&&<label className="grid min-w-0 gap-1 text-sm">Reasoning-Aufwand<select aria-label="Reasoning-Aufwand" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={effort} onChange={event=>setEffort(event.target.value)}><option value="standard">Standard des Agenten</option>{efforts.map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline">Modelländerung vorbereiten</Button><Button type="button" size="sm" variant="outline" onClick={()=>onCommand(`!modell @${agent} standard`)}>Standards wiederherstellen vorbereiten</Button></div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
