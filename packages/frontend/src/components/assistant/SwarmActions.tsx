import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ACTIONS={rat:'Rat befragen',ablauf:'Mehrstufigen Ablauf starten',review:'Ergebnis durch einen anderen Agenten prüfen',patch:'Git-Patch bearbeiten',memory:'Im Schwarm-Gedächtnis merken',alarm:'Alarmregel ändern',betrieb:'Betriebsaktion',stop:'Auftrag oder Agent stoppen'};
/** Native commands only. The existing Hub owns policy, approvals and state transitions. */
export function SwarmActions({onCommand}:{onCommand:(command:string)=>void}) {
  const [action,setAction]=useState<keyof typeof ACTIONS>('rat'),[subject,setSubject]=useState(''),[target,setTarget]=useState(''),[agent,setAgent]=useState(''),[mode,setMode]=useState('debatte');
  const change=(next:keyof typeof ACTIONS)=>{setAction(next);setSubject('');setTarget('');setMode(next==='patch'?'pruefen':next==='ablauf'?'recherche':next==='alarm'?'stumm':'debatte');};
  return <section className="space-y-3" aria-label="Native Fachaktionen">
    <div className="flex flex-wrap gap-2"><Button variant="destructive" size="sm" onClick={()=>onCommand('!stop')}>Schwarm-Stopp vorbereiten</Button><Button variant="outline" size="sm" onClick={()=>onCommand('!weiter')}>Schwarm fortsetzen vorbereiten</Button></div>
    <p className="text-xs text-muted-foreground">Der Schwarm-Stopp friert den Hub ein und bricht offene Aufträge ab. Der unabhängige signierte Not-Aus bleibt in der eingebetteten Android-Schwarmansicht erreichbar.</p>
    <form className="grid min-w-0 gap-3" onSubmit={event=>{
      event.preventDefault();let command='';
      if(action==='rat')command=`!rat ${mode} ${subject}`;
      if(action==='ablauf')command=`!ablauf ${mode} ${subject}`;
      if(action==='review')command=`!pruefen ${target} @${agent}`;
      if(action==='patch')command=`!patch ${target} ${mode}`;
      if(action==='memory')command=`!merken ${agent?'@'+agent+' ':''}${subject}`;
      if(action==='alarm')command=`!alarm ${mode} ${target}${subject?' '+subject:''}`;
      if(action==='betrieb')command=`!aktion ${target} ${agent}${subject?' '+subject:''}`;
      if(action==='stop')command=`!stop ${target}`;
      onCommand(command);
    }}>
      <label className="grid min-w-0 gap-1 text-sm">Fachaktion<select aria-label="Fachaktion" className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={action} onChange={event=>change(event.target.value as keyof typeof ACTIONS)}>{Object.entries(ACTIONS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      {['rat','ablauf','patch','alarm'].includes(action)&&<label className="grid min-w-0 gap-1 text-sm">Variante<select className="min-w-0 w-full max-w-full rounded-md border bg-background p-2" value={mode} onChange={event=>setMode(event.target.value)}>{(action==='rat'?['debatte','broadcast','vote','staffel']:action==='ablauf'?['recherche','zweitmeinung','code-aenderung','code-patch']:action==='patch'?['pruefen','anwenden','zusammenfuehren']:['stumm','still','laut']).map(value=><option key={value} value={value}>{value}</option>)}</select></label>}
      {['review','patch','alarm','betrieb','stop'].includes(action)&&<label className="grid min-w-0 gap-1 text-sm">{action==='alarm'?'Alarm-Fingerabdruck':action==='betrieb'?'Native Fähigkeit':action==='stop'?'Auftragskennung oder @Agent':'Auftragskennung'}<Input required value={target} pattern={['review','patch'].includes(action)?'T-[0-9]+':undefined} placeholder={['review','patch'].includes(action)?'T-0042':undefined} onChange={event=>setTarget(event.target.value)} /></label>}
      {['review','memory','betrieb'].includes(action)&&<label className="grid min-w-0 gap-1 text-sm">{action==='betrieb'?'Native Zielkennung':'Agent ohne @'}<Input required={action!=='memory'} value={agent} pattern={action==='betrieb'?undefined:'[-a-zA-Z0-9_/]+'} onChange={event=>setAgent(event.target.value)} /></label>}
      {['rat','ablauf','memory','alarm','betrieb'].includes(action)&&<label className="grid min-w-0 gap-1 text-sm">{action==='alarm'?'Dauer, optional':action==='betrieb'?'Grund, optional':action==='memory'?'Notiz':'Frage / Ziel'}<textarea required={['rat','ablauf','memory'].includes(action)} className="min-h-24 rounded-md border bg-background p-2" value={subject} onChange={event=>setSubject(event.target.value)} /></label>}
      <Button size="sm" variant="outline">Im Nachrichtenfeld vorbereiten</Button>
    </form>
  </section>;
}
