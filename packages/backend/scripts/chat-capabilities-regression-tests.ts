import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'chat-capabilities-fake-encryption-key-0000';
const testing = await import('../src/db/testing.js');
testing.useTestSchema();
const { run, get } = await import('../src/db/pg.js');
const { chatToolset } = await import('../src/services/assistant/chatTools.js');
const { CHAT_OPTIONS } = await import('../src/services/assistant/chatOptions.js');
const { requestChatToolApproval, decideChatToolApproval } =
  await import('../src/services/assistant/chatToolApprovals.js');
const { createResource, BODY_SCHEMAS } = await import('../src/services/assistant/resources.js');
const { readChatSkill } = await import('../src/services/assistant/chatSkills.js');
const root = await mkdtemp(path.join(tmpdir(), 'plum-capabilities-'));
if (!(await testing.databaseReachable())) throw new Error('Isolated PostgreSQL unavailable');
await testing.createTestSchema();
try {
  const home = path.join(root, 'config'),
    skillDir = path.join(home, 'skills', 'fixture-data-analysis');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: fixture-data-analysis\ndescription: Analyse tabular data\n---\n' +
      'exact instructions '.repeat(2000)
  );
  await writeFile(path.join(skillDir, 'reference.md'), 'Selected reference instructions');
  await writeFile(path.join(root, 'outside.md'), 'Must not escape');
  await symlink(path.join(root, 'outside.md'), path.join(skillDir, 'escape.md'));
  const firstPage = await readChatSkill(
    ['fixture-data-analysis'],
    { name: 'fixture-data-analysis' },
    home
  );
  assert.equal(firstPage.text.length, 16000);
  assert.equal(firstPage.nextOffset, 16000);
  const secondPage = await readChatSkill(
    ['fixture-data-analysis'],
    { name: 'fixture-data-analysis', offset: firstPage.nextOffset },
    home
  );
  assert(secondPage.text.length > 0);
  assert.equal(
    (
      await readChatSkill(
        ['fixture-data-analysis'],
        { name: 'fixture-data-analysis', file: 'reference.md' },
        home
      )
    ).text,
    'Selected reference instructions'
  );
  await assert.rejects(
    readChatSkill([], { name: 'fixture-data-analysis' }, home),
    /nicht ausgewählt/
  );
  await assert.rejects(
    readChatSkill(
      ['fixture-data-analysis'],
      { name: 'fixture-data-analysis', file: 'escape.md' },
      home
    ),
    /ausserhalb/
  );
  console.log(
    'PASS: selected functional skill, paged instructions and reference files; unselected skills and symlink escape refused'
  );
  const user = 'capabilities-owner';
  await run(
    "INSERT INTO users(id,email,provider,provider_id,role) VALUES(?,?,'test',?,'admin')",
    user,
    user + '@example.invalid',
    user
  );
  const file = path.join(root, 'catalog.mjs');
  const executed = path.join(root, 'executed');
  await writeFile(
    file,
    `import {createInterface} from 'node:readline';import{appendFileSync}from'node:fs';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05'};else if(m.method==='tools/list'){const offset=Number(m.params.cursor||0);result={tools:Array.from({length:70},(_,i)=>({name:'function_'+(i+offset),description:'Function '+(i+offset),inputSchema:{type:'object'},annotations:{readOnlyHint:i+offset!==139}})),...(offset===0?{nextCursor:'70'}:{})};}else{appendFileSync(${JSON.stringify(executed)},m.params.name+'\\n');result={content:[{type:'text',text:'confirmed'}]};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`
  );
  await run(
    "INSERT INTO mcp_servers(id,user_id,name,type,command,args,enabled) VALUES(?,?,'Fixture','subprocess',?,?,1)",
    'catalog-fixture',
    user,
    process.execPath,
    JSON.stringify([file])
  );
  const controller = new AbortController();
  const options = CHAT_OPTIONS.parse({
    mcpServerIds: ['catalog-fixture'],
    toolPermissions: {
      'catalog-fixture:function_138': 'ask',
      'catalog-fixture:function_137': 'block',
    },
  });
  assert.equal(options.toolLoading, 'on-demand');
  const tools = await chatToolset(user, options, controller.signal);
  try {
    assert.equal(
      tools.catalog.length,
      140,
      'all catalog pages, including functions after 60, are indexed'
    );
    assert.deepEqual(
      tools.tools.map((t) => t.name),
      ['find_tools']
    );
    const found = JSON.parse(await tools.call('find_tools', { query: 'function_138' }));
    const loaded = found.matches[0].name;
    assert.equal(tools.tools.length, 2);
    assert.equal(tools.requiresApproval(loaded), true);
    await assert.rejects(tools.call(loaded, {}), /Einzelgenehmigung/);
    await assert.rejects(readFile(executed), /ENOENT/, 'nothing executes without approval');
    assert.match(await tools.call(loaded, {}, true), /confirmed/);
    assert.equal(
      JSON.parse(await tools.call('find_tools', { query: 'function_137' })).matches.length,
      0,
      'blocked functions cannot be discovered'
    );
    assert.equal(
      JSON.parse(await tools.call('find_tools', { query: 'function_139' })).matches.length,
      0,
      'per-function allow does not bypass write permissions'
    );
  } finally {
    tools.close();
  }
  const chat = await createResource(
    user,
    'api-chat',
    'Fixture',
    BODY_SCHEMAS['api-chat'].parse({ providerId: 'fixture', model: 'fixture' })
  );
  const turn = randomUUID();
  const now = new Date().toISOString();
  await run(
    "INSERT INTO assistant_api_turns(id,chat_id,seq,payload_hash,prompt,status,model,profile_json,created_at,updated_at,expires_at) VALUES(?,?,1,'fixture','Fixture','running','fixture','{}',?,?,?)",
    turn,
    chat.id,
    now,
    now,
    new Date(Date.now() + 60000).toISOString()
  );
  let ready!: () => void;
  const visible = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const waiting = requestChatToolApproval(
    user,
    turn,
    'call',
    'function_138',
    {},
    controller.signal,
    async () => ready()
  );
  await visible;
  assert.equal(
    (await get('SELECT decision FROM assistant_api_tool_approvals WHERE turn_id=?', turn)).decision,
    'pending'
  );
  await assert.rejects(
    decideChatToolApproval('another-owner', chat.id, turn, 'call', 'allow'),
    /nicht gefunden/
  );
  await decideChatToolApproval(user, chat.id, turn, 'call', 'deny');
  assert.equal(await waiting, false);
  await decideChatToolApproval(user, chat.id, turn, 'call', 'deny');
  await assert.rejects(decideChatToolApproval(user, chat.id, turn, 'call', 'allow'), /bereits/);
  console.log(
    'PASS: paginated 140-tool discovery, lazy definitions, read-only ceiling, blocked/ask rights, durable owner-bound deny and idempotent decisions; no model or external API called'
  );
} finally {
  await testing.dropTestSchema();
  await rm(root, { recursive: true, force: true });
}
