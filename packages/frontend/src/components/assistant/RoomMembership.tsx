import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RoomMembership({roomId,nativeUserId,epoch,onJoined,onLeft}:{roomId:string;nativeUserId:string;epoch?:string;onJoined:(id:string)=>void;onLeft:()=>void}) {
  const account=useAuthStore(state=>state.user?.id),cache=useQueryClient();
  const [target,setTarget]=useState('');
  const invitations=useQuery({queryKey:['assistant','matrix-invitations',account,epoch],queryFn:async()=>(await api.get<{data:Array<{id:string;name:string;invitedBy:string|null}>}>('/api/assistant/matrix/invitations')).data.data,refetchInterval:30000});
  const members=useQuery({queryKey:['assistant','matrix-members',roomId,account,epoch],queryFn:async()=>(await api.get<{data:Array<{userId:string;name:string;membership:string}>}>(`/api/assistant/matrix/rooms/${encodeURIComponent(roomId)}/members`)).data.data,enabled:!!roomId,refetchInterval:30000});
  const action=useMutation({mutationFn:async(input:{room:string;action:'join'|'leave'|'invite';target?:string})=>{
    await api.post(`/api/assistant/matrix/rooms/${encodeURIComponent(input.room)}/membership`,{action:input.action,nativeUserId,target:input.target});return input;
  },onSuccess:input=>{
    void cache.invalidateQueries({queryKey:['assistant']});
    if(input.action==='join')onJoined(input.room);
    if(input.action==='leave'&&input.room===roomId)onLeft();
    if(input.action==='invite')setTarget('');
  }});
  return <details className="rounded-md border bg-card p-3" aria-label="Räume und Mitglieder"><summary className="cursor-pointer font-medium">Räume und Mitglieder</summary><div className="mt-3 space-y-3">
    {invitations.data?.map(room=><article className="space-y-2 rounded-md border p-3" key={room.id}><h3 className="font-medium">Einladung: {room.name}</h3><p className="break-all text-xs text-muted-foreground">Von {room.invitedBy ?? 'unbekannt'}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={action.isPending} onClick={()=>action.mutate({room:room.id,action:'join'})}>Beitreten</Button><Button size="sm" variant="outline" disabled={action.isPending} onClick={()=>action.mutate({room:room.id,action:'leave'})}>Einladung ablehnen</Button></div></article>)}
    {!invitations.isLoading && !invitations.data?.length && <p className="text-sm text-muted-foreground">Keine offenen Einladungen.</p>}
    {roomId && <><h3 className="font-medium">Mitglieder im ausgewählten Raum</h3>{members.isLoading?<p role="status">Mitglieder werden geladen …</p>:<ul className="max-h-64 space-y-2 overflow-y-auto text-sm">{members.data?.filter(member=>['join','invite'].includes(member.membership)).map(member=><li key={member.userId} className="break-words"><span>{member.name}</span><span className="block break-all text-xs text-muted-foreground">{member.userId} · {member.membership==='invite'?'Eingeladen':'Mitglied'}</span></li>)}</ul>}
      <form className="grid gap-2" onSubmit={event=>{event.preventDefault();action.mutate({room:roomId,action:'invite',target});}}><label className="grid gap-1 text-sm">Matrix-Konto einladen<Input required value={target} placeholder="@name:server" pattern={String.raw`@[^:\s]+:[^\s]+`} onChange={event=>setTarget(event.target.value)} /></label><Button size="sm" variant="outline" disabled={action.isPending}>Einladen</Button></form>
      <Button size="sm" variant="outline" disabled={action.isPending} onClick={()=>action.mutate({room:roomId,action:'leave'})}>Ausgewählten Raum verlassen</Button>
    </>}
    {(action.error||invitations.error||members.error)&&<p role="alert" className="text-sm text-destructive">{action.error?.message||invitations.error?.message||members.error?.message}</p>}
  </div></details>;
}
