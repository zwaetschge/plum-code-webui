#!/usr/bin/env node
/** Offline, idempotent restoration from the private snapshot; never writes to Open WebUI. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {all,get,run,transaction,closePool} from '../packages/backend/dist/db/pg.js';
import {createResource} from '../packages/backend/dist/services/assistant/resources.js';
import {importChats,parseChatArchive} from '../packages/backend/dist/services/assistant/chatPortability.js';
import {apiChatProviders} from '../packages/backend/dist/services/assistant/apiTransport.js';
import {imageMime} from '../packages/backend/dist/services/assistant/apiFiles.js';
const archive=path.resolve(process.argv[2]??'data/private-migrations/openwebui-20261025');
const apply=process.argv.includes('--apply');
const manifest=JSON.parse(await fs.readFile(path.join(archive,'manifest.json'),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const users=await all('SELECT id,email FROM users');
const mappings=new Map();
for(const source of manifest.users){const matches=users.filter(u=>u.email.toLowerCase()===source.email.toLowerCase());if(matches.length===1)mappings.set(source.id,matches[0].id);}
const report={applied:apply,archive,mappedAccounts:mappings.size,sourceChats:manifest.chats.length,sourceFiles:manifest.files.length,importedChats:0,importedBranches:0,importedFiles:0,linkedAttachments:0,inlineImages:0,unmatchedChatOwners:[],failures:[],missingFiles:[],sourceTruncations:0};
const inArchive=file=>{const resolved=path.resolve(file);if(!resolved.startsWith(archive+path.sep))throw Error('Invalid archive path');return resolved;};
const mimeFor=name=>({'.md':'text/markdown','.txt':'text/plain','.json':'application/json','.html':'text/html','.epub':'application/epub+zip','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[path.extname(name).toLowerCase()]??'application/octet-stream');
const assets=new Map(),sources=new Map();
async function asset(tx,userId,bytes,name,mime){return await tx.get('INSERT INTO assistant_assets(id,user_id,filename,mime_type,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,sha256) DO UPDATE SET sha256=excluded.sha256 RETURNING id',randomUUID(),userId,name,mime,sha(bytes),bytes,new Date().toISOString());}
try{
if(apply){
for(const file of manifest.files){
 const target=mappings.get(file.user_id);if(!target)continue;
 if(file.missing||!file.original){report.missingFiles.push(file.id);continue;}
 try{
  const bytes=await fs.readFile(inArchive(file.original));if(sha(bytes)!==file.sha256)throw Error('Original checksum mismatch');
  const key=`openwebui-file:${file.id}:${file.sha256}`;
  const result=await transaction(async tx=>{
   await tx.get('SELECT id FROM users WHERE id=? FOR UPDATE',target);
   const prior=await tx.get('SELECT result_json FROM assistant_commands WHERE user_id=? AND command_id=?',target,key);if(prior)return JSON.parse(prior.result_json);
   const mime=mimeFor(file.filename),original=await asset(tx,target,bytes,file.filename,mime);
   let extracted={};try{extracted=JSON.parse(file.data??'{}');}catch{/* bytes remain the source of truth */}
   const content=String(extracted.content??extracted.text??(['.md','.txt','.html','.json'].includes(path.extname(file.filename).toLowerCase())?bytes.toString('utf8'):''));
   if(content.length>500000)report.sourceTruncations++;
   const source=await createResource(target,'source',file.filename,{text:content.slice(0,500000)||file.filename,mimeType:mime,filename:file.filename,assetId:original.id,sha256:file.sha256,citation:file.filename,truncated:content.length>500000,ingestion:'ready',importedFrom:'openwebui',importSourceId:file.id,extraction:content?'imported-text':'original-only'},tx);
   const value={sourceId:source.id,assetId:original.id,mimeType:mime};
   await tx.run("INSERT INTO assistant_commands(user_id,command_id,resource_id,action,status,payload_hash,result_json,created_at,updated_at) VALUES(?,?,?,?,'completed',?,?,?,?)",target,key,source.id,'openwebui-file',file.sha256,JSON.stringify(value),new Date().toISOString(),new Date().toISOString());return value;
  });
  sources.set(file.id,result);assets.set(file.id,{...result,userId:target});report.importedFiles++;
 }catch(error){report.failures.push({file:file.id,error:error.message});}
}
for(const item of manifest.chats){
 const target=mappings.get(item.user_id);if(!target){report.unmatchedChatOwners.push(item.user_id);continue;}
 try{
  const bytes=await fs.readFile(inArchive(item.archive));if(sha(bytes)!==item.sha256)throw Error('Chat checksum mismatch');
  const provider=(await apiChatProviders(target))[0];
  const parsed=parseChatArchive(JSON.parse(bytes));
  const imported=await importChats(target,bytes,provider?.id??'imported',provider?.models[0]??'imported-history',{historicalOnly:true});
  for(let index=0;index<imported.chats.length;index++){
   const chat=imported.chats[index],branch=parsed[index];if(!branch)throw Error('Branch mapping mismatch');
   await transaction(async tx=>{
    await tx.get('SELECT id FROM assistant_resources WHERE id=? AND user_id=? FOR UPDATE',chat.id,target);
    const turns=await tx.all('SELECT id,seq FROM assistant_api_turns WHERE chat_id=? ORDER BY seq',chat.id);
    let turnIndex=0,pendingFiles=[],pendingImages=[];
    const attach=async()=>{
     const turn=turns[turnIndex++];if(!turn)return;
     const docs=[...new Set(pendingFiles.map(id=>sources.get(id)?.sourceId).filter(Boolean))];
     const images=[...new Set(pendingImages)];
     const versions=docs.map(id=>({id,revision:1}));
     const evidence=[];
     for(const source of versions){const row=await tx.get('SELECT title,body_json FROM assistant_resources WHERE id=? AND user_id=?',source.id,target);const body=JSON.parse(row.body_json);evidence.push({...source,title:row.title,text:String(body.text??'').slice(0,4000),citation:row.title,page:null,excerptStart:0,retrieval:'imported'});}
     await tx.run('UPDATE assistant_api_turns SET source_versions=?,image_asset_ids=?,workbench_json=? WHERE id=? AND chat_id=?',JSON.stringify(versions),JSON.stringify(images),JSON.stringify({documentSourceIds:docs,sources:evidence,toolEvents:[],comparisons:[]}),turn.id,chat.id);
     for(const imageId of images)await tx.run('INSERT INTO assistant_api_files(chat_id,asset_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',chat.id,imageId,new Date().toISOString());
     report.linkedAttachments+=docs.length;pendingFiles=[];pendingImages=[];
    };
    for(const message of branch.messages){
     for(const file of message.files??[]){const id=file.id??file.file?.id;const original=assets.get(id);if(original?.userId===target){pendingFiles.push(id);if(original.mimeType.startsWith('image/'))pendingImages.push(original.assetId);}else if(id)report.missingFiles.push(id);}
     const imageUrls=[];
     if(Array.isArray(message.content))for(const part of message.content){if(part?.type==='image_url'&&part.image_url?.url)imageUrls.push(part.image_url.url);}
     if(typeof message.content==='string')for(const match of message.content.matchAll(/!\[[^\]]*\]\((data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)\)/gi))imageUrls.push(match[1]);
     for(const url of imageUrls){const match=/^data:(image\/[\w+]+);base64,([A-Za-z0-9+/=]+)$/.exec(url);if(!match)continue;const image=Buffer.from(match[2],'base64');if(image.length>25*1024*1024)throw Error('Inline image exceeds25MB');const mime=imageMime(image),stored=await asset(tx,target,image,'imported-image.'+mime.split('/')[1],mime);pendingImages.push(stored.id);report.inlineImages++;}
     if(message.role==='assistant')await attach();
    }
    if(pendingFiles.length||pendingImages.length)await attach();
    const resource=await tx.get('SELECT body_json FROM assistant_resources WHERE id=?',chat.id);const body=JSON.parse(resource.body_json);body.openWebUiOrigin={id:item.id,archived:!!item.archived,createdAt:item.created_at,updatedAt:item.updated_at};
    await tx.run('UPDATE assistant_resources SET body_json=? WHERE id=?',JSON.stringify(body),chat.id);
    await tx.run('UPDATE assistant_resource_revisions SET body_json=? WHERE resource_id=? AND revision=1',JSON.stringify(body),chat.id);
   });
  }
  report.importedChats++;report.importedBranches+=imported.chats.length;
  if(report.importedChats%10===0)console.log(JSON.stringify({progress:report.importedChats,total:manifest.chats.length}));
 }catch(error){report.failures.push({chat:item.id,error:error.message});}
}
}
report.unmatchedChatOwners=[...new Set(report.unmatchedChatOwners)];report.missingFiles=[...new Set(report.missingFiles)];
await fs.writeFile(path.join(archive,apply?'result.json':'dry-run.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report));
if(report.failures.length||report.missingFiles.length||report.unmatchedChatOwners.length)process.exitCode=2;
}finally{await closePool();}
