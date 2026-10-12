import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SwarmActions } from './SwarmActions';
import { NativeModelControls } from './NativeModelControls';

type Content=Record<string,unknown>;
interface StateEvent { type:string; sender?:string; state_key?:string; content:Content }
const AREAS:Record<string,string>={
  aktionen:'Fachaktionen',
  kontingente:'Kontingente',routinen:'Routinen',modelle:'Modelle',stimmen:'OmniVoice-Stimmen',rollen:'Rollen',einheiten:'Plum-Sitzungen',tuersteher:'Türsteher',kennzahlen:'Kennzahlen',tagesbericht:'Tagesbericht',litellm:'Brian / LiteLLM',ruhe:'Ruhezeit',release:'Hub-Stand',notaus:'Not-Aus-Geräte',
};
const list=(value:unknown):Content[] => Array.isArray(value) ? value.filter((entry):entry is Content => !!entry && typeof entry==='object') : [];
const text=(value:unknown) => typeof value==='string' || typeof value==='number' ? String(value) : '';
export function SwarmControlPanel({ events,userId,onCommand }: { events:StateEvent[]; userId:string; onCommand:(command:string) => void }) {
  const [area,setArea]=useState('routinen');
  const [name,setName]=useState(''),[schedule,setSchedule]=useState('werktags 07:00'),[agent,setAgent]=useState('brian'),[goal,setGoal]=useState('');
  const hub=`@schwarm:${userId.split(':').slice(1).join(':')}`;
  const trusted=events.filter((event) => event.sender === hub && (event.content.v === undefined || event.content.v === 1));
  const selected=trusted.filter((event) => event.type === `ch.zwaetschge.swarm.${area}`);
  const models=trusted.filter((event) => event.type === 'ch.zwaetschge.swarm.modelle');
  const voices=list(trusted.find((event) => event.type === 'ch.zwaetschge.swarm.stimmen')?.content.stimmen).filter((voice) => voice.engine === 'omnivoice');
  return <details className="space-y-4 rounded-lg border bg-card p-4" aria-label="Schwarm steuern">
    <summary className="cursor-pointer font-semibold">Schwarm steuern</summary>
    <label className="grid min-w-0 gap-2 text-sm">Bereich<select aria-label="Bereich" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={area} onChange={(event) => setArea(event.target.value)}>{Object.entries(AREAS).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    {area==='aktionen' && <SwarmActions onCommand={onCommand}/>}
    {!selected.length && area!=='aktionen' && <p className="text-sm text-muted-foreground">Für diesen Bereich liegt noch kein bestätigter Hub-Stand vor.</p>}
    {area === 'routinen' && <>
      {selected.flatMap((event) => list(event.content.routinen)).map((routine) => <article className="space-y-2 rounded-md border p-3" key={text(routine.name)}>
        <h3 className="font-medium">{text(routine.name)}</h3><p className="text-sm">{text(routine.zeitplan)} · {text(routine.agent)} · {routine.pausiert ? 'Pausiert' : 'Aktiv'}</p><p className="text-sm">{text(routine.ziel)}</p>
        <div className="flex flex-wrap gap-2">{['jetzt',routine.pausiert ? 'weiter' : 'pause','weg'].map((action) => <Button key={action} size="sm" variant="outline" onClick={() => onCommand(`!routine ${action} ${text(routine.name)}`)}>{action === 'jetzt' ? 'Jetzt starten' : action === 'weg' ? 'Entfernen vorbereiten' : action === 'pause' ? 'Pausieren' : 'Fortsetzen'}</Button>)}</div>
      </article>)}
      <form className="grid min-w-0 gap-3" onSubmit={(event) => { event.preventDefault(); onCommand(`!routine neu ${name} ${schedule} @${agent} ${goal}`); }}>
        <label className="grid min-w-0 gap-1 text-sm">Neue Routine<Input required value={name} placeholder="morgenbriefing" pattern="[a-z0-9][a-z0-9-]{1,39}" onChange={(event) => setName(event.target.value)} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Zeitplan · Europe/Zurich<Input required value={schedule} onChange={(event) => setSchedule(event.target.value)} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Agent<Input required value={agent} onChange={(event) => setAgent(event.target.value)} /></label>
        <label className="grid min-w-0 gap-1 text-sm">Ziel<textarea required className="min-h-24 rounded-md border bg-background p-2" value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
        <Button size="sm">Befehl vorbereiten</Button>
      </form>
    </>}
    {(area === 'modelle' || area === 'stimmen') && models.map((event) => {
      const id=event.state_key || text(event.content.agent);
      return <article key={id} className="space-y-2 rounded-md border p-3"><h3 className="font-medium">{id}</h3><p className="text-sm">{text(event.content.modell)} · {text(event.content.art)} · {text(event.content.wirkt)}</p>
        {area === 'modelle' && <NativeModelControls key={id} agent={id} stand={event.content} onCommand={onCommand} />}
        {area === 'stimmen' && <label className="grid min-w-0 gap-1 text-sm">OmniVoice<select className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value="" onChange={(change) => { if(change.target.value) onCommand(`!stimme @${id} ${change.target.value}`); }}><option value="">Stimme vorbereiten</option>{voices.map((voice) => <option key={text(voice.id)} value={text(voice.id)}>{text(voice.name) || text(voice.id)}</option>)}</select></label>}
        {typeof event.content.bestaetigung === 'string' && <p className="text-sm text-muted-foreground">{event.content.bestaetigung}</p>}
      </article>;
    })}
    {!['routinen','modelle','stimmen'].includes(area) && selected.map((event,index) => <div key={`${event.state_key}-${index}`} className="overflow-x-auto rounded-md border p-3"><ReadableData value={event.content} /></div>)}
    <p className="text-xs text-muted-foreground">Änderungen gehen als native Befehle an den Hub. Erst seine Rückmeldung bestätigt den neuen Stand.</p>
  </details>;
}
function ReadableData({ value,depth=0 }: { value:unknown; depth?:number }) {
  if (depth>4 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return <div className="space-y-2">{value.slice(0,100).map((item,index) => <div key={index} className="rounded-md border p-2"><ReadableData value={item} depth={depth+1} /></div>)}</div>;
  if (typeof value === 'object') return <dl className="space-y-2 text-sm">{Object.entries(value).filter(([key]) => key !== 'v' && !/(secret|token|password|cookie|authorization|private_key|api_key)/i.test(key)).map(([key,item]) => <div key={key}><dt className="font-medium">{key.replace(/_/g,' ')}</dt><dd className="mt-1 text-muted-foreground"><ReadableData value={item} depth={depth+1} /></dd></div>)}</dl>;
  return <span>{typeof value === 'boolean' ? value ? 'Ja' : 'Nein' : String(value)}</span>;
}
