import { useState } from 'react';
import { useInfiniteQuery,useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AssistantResource,AssistantResourceKind } from '@plum-code-webui/shared';

export interface ResourceReference {id:string;kind:AssistantResourceKind;title:string;revision:number}
export function useResourceReferences(ids:string[]) {
  const account=useAuthStore(state=>state.user?.id);
  return useQuery({queryKey:['assistant','references',account,ids],queryFn:async()=>(await api.post<{data:ResourceReference[]}>('/api/assistant/references',{ids})).data.data,enabled:!!ids.length});
}
export function ResourcePicker({label,value,onChange,kind,maximum=100,excludeId}:{label:string;value:string[];onChange:(ids:string[])=>void;kind?:AssistantResourceKind;maximum?:number;excludeId?:string}) {
  const [search,setSearch]=useState(''),account=useAuthStore(state=>state.user?.id);
  const collection=kind?kind==='memory'?'memory':`${kind}s`:'search';
  const choices=useInfiniteQuery({queryKey:['assistant','picker',account,kind,search],initialPageParam:0,queryFn:async({pageParam})=>(await api.get<{data:AssistantResource[]}>(`/api/assistant/${collection}?${new URLSearchParams({limit:'50',offset:String(pageParam),...(search?{search}:{})})}`)).data.data,getNextPageParam:(last,_pages,offset)=>last.length===50?offset+50:undefined});
  const selected=useResourceReferences(value);
  const options=[...new Map((choices.data?.pages.flat()??[]).filter(item=>item.id!==excludeId).map(item=>[item.id,item])).values()];
  return <fieldset className="space-y-2 rounded-md border p-3"><legend className="px-1 text-sm font-medium">{label}</legend>
    <div className="flex flex-wrap gap-2">{value.map(id=><Button type="button" variant="outline" size="sm" key={id} onClick={()=>onChange(value.filter(item=>item!==id))}>{selected.data?.find(item=>item.id===id)?.title ?? options.find(item=>item.id===id)?.title ?? (selected.isLoading?'Wird geladen …':'Nicht mehr verfügbar')} · Entfernen</Button>)}</div>
    <Input aria-label={`${label} durchsuchen`} placeholder="In deiner Bibliothek suchen" value={search} onChange={event=>setSearch(event.target.value)} />
    <div className="max-h-52 space-y-1 overflow-y-auto">{options.map(item=><label key={item.id} className="flex items-start gap-2 py-1 text-sm"><input type="checkbox" className="mt-1" checked={value.includes(item.id)} disabled={!value.includes(item.id)&&maximum>1&&value.length>=maximum} onChange={event=>onChange(event.target.checked?maximum===1?[item.id]:[...value,item.id]:value.filter(id=>id!==item.id))}/><span className="break-words">{item.title}</span></label>)}</div>
    {choices.isFetching?<p role="status" className="text-xs">Bibliothek wird durchsucht …</p>:!options.length&&<p className="text-xs text-muted-foreground">Keine passenden Einträge.</p>}
    {choices.hasNextPage&&<Button type="button" size="sm" variant="outline" disabled={choices.isFetchingNextPage} onClick={()=>void choices.fetchNextPage()}>Weitere Einträge laden</Button>}
    {(choices.error||selected.error)&&<p role="alert" className="text-sm text-destructive">{choices.error?.message||selected.error?.message}</p>}
  </fieldset>;
}
