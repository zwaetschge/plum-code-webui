import assert from 'node:assert/strict';
import { parseHostConfig, resolveBinding, assertAction, remoteRunner } from '../src/services/assistant/swarmContainers.js';

const config = parseHostConfig({ hosts: [
  {id:'geekom',label:'Geekom'},
  {id:'unraid',label:'Unraid',ssh:{target:'root@192.168.1.126',identityFile:'/private/key',knownHostsFile:'/public/hosts'}},
], containers:[
  {name:'worker',host:'unraid',actions:['start','restart']},
  {name:'retired',host:'unraid',actions:[]},
  {name:'repair-bot',host:'geekom',actions:[]},
] });
const names = new Set(['worker','retired','repair-bot']);
assert.equal(resolveBinding(config,names,'worker','unraid').host,'unraid');
assert.equal(resolveBinding(config,names,'worker').host,'unraid','old clients use the unique configured host');
assert.throws(()=>resolveBinding(config,names,'worker','geekom'),/nicht freigegeben/);
assert.throws(()=>resolveBinding(config,new Set(),'worker','unraid'),/nicht freigegeben/);
assert.throws(()=>resolveBinding(config,names,'worker;touch x','unraid'),/nicht freigegeben/);
assert.throws(()=>assertAction(resolveBinding(config,names,'retired'),'start'),/nicht freigegeben/);
assertAction(resolveBinding(config,names,'worker'),'restart');
assert.throws(()=>assertAction(resolveBinding(config,names,'worker'),'stop'),/nicht freigegeben/);
assert.throws(()=>assertAction({name:'plum-swarm-coordinator',host:'unraid',actions:['stop']},'stop'));
assert.throws(()=>parseHostConfig({...config,containers:[...config.containers,{...config.containers[0],host:'geekom'}]}),/Mehrdeutige/);
assert.throws(()=>parseHostConfig({...config,containers:[{name:'x',host:'missing'}]}),/Mehrdeutige/);
assert.throws(()=>parseHostConfig({...config,hosts:[{id:'unraid',label:'Unraid',ssh:{target:'-oProxyCommand=bad',identityFile:'/key',knownHostsFile:'/hosts'}}]}));
let captured: unknown[] = [];
const execute = async (...args: unknown[]) => { captured = args; return {stdout:'ok',stderr:''}; };
const run = remoteRunner(config.hosts[1]!.ssh!, execute as never);
assert.deepEqual(await run(['logs', '--tail', '5', "worker'; touch /tmp/no"]),{stdout:'ok',stderr:''});
assert.equal(captured[0],'ssh');
const argv = captured[1] as string[];
assert(argv.includes('StrictHostKeyChecking=yes'));
assert.equal(argv.at(-2),'root@192.168.1.126');
assert.equal(argv.at(-1),"docker 'logs' '--tail' '5' 'worker'\\''; touch /tmp/no'");
assert(!argv.includes('touch'));
console.log('Swarm hosts: 15 routing, permission and SSH boundary checks passed');
