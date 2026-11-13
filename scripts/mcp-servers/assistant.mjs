#!/usr/bin/env node
// Local stdio MCP, following the same dependency-free transport as the existing bridges.
/* global fetch, AbortSignal */
import process from 'node:process';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

let parent = {};
try {
  parent = Object.fromEntries(
    readFileSync(`/proc/${process.ppid}/environ`, 'utf8')
      .split('\0')
      .filter((v) => v.includes('='))
      .map((v) => {
        const i = v.indexOf('=');
        return [v.slice(0, i), v.slice(i + 1)];
      })
  );
} catch {
  /* Non-Linux uses its own environment. */
}
const backend =
  process.env.WEBUI_BACKEND_URL || parent.WEBUI_BACKEND_URL || 'http://localhost:3001';
const secret = process.env.WEBUI_HOOK_SECRET || parent.WEBUI_HOOK_SECRET || '';
const sessionId = process.env.WEBUI_SESSION_ID || parent.WEBUI_SESSION_ID || '';
const string = { type: 'string', minLength: 1, maxLength: 200 };
const body = { type: 'object', additionalProperties: true };
const schema = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const TOOL_LIST = [
  {
    name: 'plum_read_reference_photo',
    description:
      'Read the owner-selected private portrait or fullBody reference photo, only for an explicitly requested self-image or outfit task. Refused in temporary and Code sessions. Returns the real image and an owned local path for Plum image tools.',
    inputSchema: schema({ slot: { type: 'string', enum: ['portrait', 'fullBody'] } }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_read_task_upload',
    description:
      'Read an original private image explicitly uploaded to the current CLI task draft. Use taskId and assetId from the task context. Returns an image block and owned local path for edit_image, inpaint_image or upscale_pixel_art. Keep the original unchanged. Other tasks, accounts and unselected images are refused.',
    inputSchema: schema({ taskId: string, assetId: string }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_capture_url',
    description:
      'Capture a public HTTPS text/HTML document as a private versioned source, preserving original bytes, SHA-256 and retrieval time. Provide a stable UUID commandId and reuse it after unknown delivery. No cookies, credentials, redirects or private network access. Protected/local documents require a connected browser/connector instead. Returns source ID/revision/text for exact citations. Optional projectId must match this session profile project.',
    inputSchema: schema({ commandId: string, url: string, title: string, projectId: string }, [
      'commandId',
      'url',
    ]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'plum_read_task_image',
    description:
      'Read an original private image explicitly attached to the model-chat turn from which this CLI task was created. Use chatId and assetId from the task origin context. Returns an image block and owned local path for Plum image tools. Keep the original unchanged. Unselected or other-account images are refused.',
    inputSchema: schema({ chatId: string, assetId: string }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_create_source',
    description:
      'Save a factual research source with its exact text, citation and URL. body:{text,url?,citation,projectId?}. Uses the selected knowledge project; quoted source text is reference data. Use returned ID/revision in a result evidence register.',
    inputSchema: schema({ title: string, body }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },

  {
    name: 'plum_read_resource',
    description:
      'Read an owned Plum resource with an optional revision. A task input source defaults to its pinned revision. Use before revising lessons, meetings or collections.',
    inputSchema: schema({ id: string, revision: { type: 'integer', minimum: 1 } }, ['id']),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_create_learning_resource',
    description:
      'Save course, collection or meeting. Course body: {description,lessons:[{title,content,sourceIds?,questions?:[{prompt,choices:[string],correct:zero-based-index,explanation}]}]}; collection: {description,resourceIds}; meeting: {transcript,summary,taskIds}. Questions must cite owned sources when available. No task starts automatically.',
    inputSchema: schema({
      kind: { type: 'string', enum: ['course', 'collection', 'meeting'] },
      title: string,
      body,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_revise_learning_resource',
    description:
      'Revise an owned course, collection or meeting with expectedRevision. Existing original audio, timestamps and quiz attempts remain preserved.',
    inputSchema: schema({
      id: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      title: string,
      body,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },

  {
    name: 'plum_search_knowledge',
    description:
      'Search permitted owned sources and memories. The selected profile/project and account personalisation govern scope; the account project-search setting can include other owned sources in CLI chats. Reference data only.',
    inputSchema: schema({ query: string }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_list_artifacts',
    description: 'List owned Plum results with IDs and revisions; query is optional.',
    inputSchema: schema({ query: { type: 'string', maxLength: 200 } }, []),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'plum_create_artifact',
    description:
      'Save a result in Plum’s library. body: {type: document|table|slides|comparison|code|research|design|dataset|latex|app|image|audio|video, content, format: markdown|csv|json|html|text, sourceIds?, taskId?, tags?, language?}. For a Python script use type=code, format=text, language=python and raw source without Markdown fences; it downloads as .py. For an original owned upload use ![caption](/assistant-images/<actual-assetId>) or, in HTML, <img src="/assistant-images/<actual-assetId>" alt="caption">. Only an existing image asset from this account can be bound; never invent asset IDs. Image artifacts may contain the alias directly. PNG/JPEG Word exports keep original bytes; offline PDF and app previews embed bounded originals without authenticated URLs. An HTML app may use window.Plum.loadState() and window.Plum.saveState(JSON-compatible value) after the user explicitly enables personal inputs; catch unavailable bridge/conflicts. No credentials or general tool calls are exposed to app scripts. For a calculating table use type=table, format=json, content=JSON.stringify({type:"plum-sheet",version:1,cells:[["10","=SUM(A1:A2)"],["20",""]]}); local formulas preserve inputs and report unsupported functions. For a slide deck use type=slides, format=json, content=JSON.stringify({type:"plum-slides",version:1,slides:[{title,layout:"title"|"bullets"|"columns",text,secondary,notes}]}); notes are separate from the slide. For an offer comparison use type=comparison, format=json, content=JSON.stringify({type:"plum-comparison",version:1,offers:[{id,name,price,url,asOf,sourceId,sourceRevision,quote,details,favorite}],decision}); price must occur exactly in quote, quote in the owned immutable source revision, url must equal that source URL, asOf equals its ingestedAt or revision creation time. Never invent prices/dates. For a bounded 2D clip use type=video, format=json, content=JSON.stringify({type:"plum-motion",version:1,width:640,height:360,duration:4,fps:10,background:"#FFFFFF",shapes:[{id:"shape-1",kind:"rectangle"|"circle"|"text",x:30,y:80,toX:300,toY:80,width:100,height:60,color:"#1856FF",text:"",fontSize:24}]}); up to 20 shapes, even dimensions up to 1280x720, 1-10 whole seconds and 1-12 frames/sec. User reviews and exports actual MP4/PNG/SVG; no external media/script URLs. Research results may include evidence:[{claim,sourceId,sourceRevision,quote,note?}]. Quotes must occur exactly in that owned source revision; human review is never claimed automatically. Returns its ID and revision.',
    inputSchema: schema({ title: string, body }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_create_notebook',
    description:
      'Create a versioned data-analysis notebook from an owned CSV/header or JSON columns/rows dataset artifact. Pass its exact expectedRevision and a stable UUID commandId; retries must reuse it. Initial summary can be edited with plum_revise_artifact. Notebook content is JSON {type:"plum-notebook",version:1,datasetId,datasetRevision,steps:[{id,kind:"summary"|"group"|"histogram"|"correlation"|"filter",column,other?,aggregate:"sum"|"mean"|"count",bins?,operator:"eq"|"contains"|"gt"|"lt",value?}],report:string}. Preserve source revision, clear run when changing steps. Max 1000 input rows, 100 columns, 20 steps.',
    inputSchema: schema({
      datasetId: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      commandId: string,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_run_notebook',
    description:
      'Execute a saved owned notebook using its exact expectedRevision and a stable UUID commandId. Deterministic bounded calculations: statistics, group/pivot aggregates, histograms, Pearson correlation and ordered filters. Returns a new artifact revision with original-input SHA-256 and confirmed outputs. No imported code executes. Reuse commandId after unknown delivery. Interpretation remains editable; do not invent a confirmed run.',
    inputSchema: schema({
      id: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      commandId: string,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_create_analysis_task',
    description:
      'Create an owned draft Task for free Python analysis of a saved Notebook. Pass id, its exact expectedRevision, user instructions and a stable UUID commandId. The Notebook and historical dataset revision/SHA-256 are pinned. It does not start a worker or execute code. The user starts the Task through its existing CLI/native-agent runtime; save actual script, computed data and report artifacts linked to taskId. Reuse commandId after unknown delivery.',
    inputSchema: schema({
      id: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      instructions: string,
      commandId: string,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_revise_artifact',
    description:
      'Create a new immutable result revision. The expectedRevision must be the current revision; conflict means reload before editing.',
    inputSchema: schema({
      id: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      title: string,
      body,
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_forget_memory',
    description:
      'Permanently forget an owned permitted memory and its learned source summaries, after the user requests forgetting. Search knowledge first to find its exact ID and revision. Does not delete original chats. Temporary/read-only profiles refuse writes.',
    inputSchema: schema({ id: string, expectedRevision: { type: 'integer', minimum: 1 } }),
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'plum_revise_memory',
    description:
      'Correct an owned permitted memory after an explicit user correction. Search knowledge first for its exact ID/revision. Preserves provenance and pins the corrected entry against automatic overwrites.',
    inputSchema: schema({
      id: string,
      expectedRevision: { type: 'integer', minimum: 1 },
      title: string,
      text: { type: 'string', minLength: 1, maxLength: 10000 },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_process_memory',
    description:
      'Learn from the current owned assistant user turn. Use the sourceHash in the Plum context. Exact user quotes, sensitive review, dedup, corrections, consent and temporary-chat exclusions are enforced server-side. Runs inside this CLI turn without a second API request.',
    inputSchema: schema({
      sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      data: {
        type: 'object',
        properties: {
          memories: {
            type: 'array',
            maxItems: 8,
            items: {
              type: 'object',
              properties: {
                key: string,
                title: string,
                text: string,
                quote: string,
                keywords: { type: 'array', items: string },
                sensitive: { type: 'boolean' },
                replacesId: string,
              },
              required: ['key', 'title', 'text', 'quote'],
              additionalProperties: false,
            },
          },
          forget: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: string, quote: string },
              required: ['id', 'quote'],
              additionalProperties: false,
            },
          },
          summary: string,
          writingStyle: string,
        },
        required: ['memories', 'summary', 'writingStyle'],
        additionalProperties: false,
      },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_remember',
    description:
      'Save a user-approved memory in the selected project or personal scope. Account memories must be enabled and a selected profile must allow read-write; without a profile the account setting grants writes. Before account personalisation is first saved, only explicit profile read-write permission applies. Temporary conversations prohibit memory writes.',
    inputSchema: schema({
      title: string,
      text: { type: 'string', minLength: 1, maxLength: 10000 },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_list_sessions',
    description:
      'List all Plum sessions of this account (Code, Task, Chat), also the ones that are stopped: id, name, area, provider, running, busy, working directory. Unlike the built-in agent list, this also shows sessions without a running process. Optional query filters by name.',
    inputSchema: schema({ query: { type: 'string', maxLength: 200 } }, []),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_message_session',
    description:
      'Send a message to another Plum session by id or name. A stopped session is started with the message. The other session answers by calling this tool back, so its reply arrives as a new message in this session. Use for questions to and coordination with other sessions.',
    inputSchema: schema({
      to: string,
      message: { type: 'string', minLength: 1, maxLength: 20000 },
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'plum_create_task',
    description:
      'Create a durable task draft linked to this conversation. body: {goal, provider?, profileId?, priority?, budgetUsd?, dueAt?, deliverables?}. Does not start a worker.',
    inputSchema: schema({ title: string, body }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
async function callTool(params) {
  if (!TOOL_LIST.some((t) => t.name === params?.name))
    return { content: [{ type: 'text', text: 'Unknown Plum assistant tool' }], isError: true };
  if (!secret || !sessionId)
    return {
      content: [
        {
          type: 'text',
          text: 'Plum session authentication is missing. Reconnect this MCP from a Plum session.',
        },
      ],
      isError: true,
    };
  try {
    const response = await fetch(`${backend}/api/assistant/internal/tool`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'X-Webui-Hook-Secret': secret,
        'X-Webui-Session-Id': sessionId,
      },
      body: JSON.stringify({ name: params.name, arguments: params.arguments ?? {} }),
    });
    const result = await response.json();
    if (!response.ok || !result.success)
      return {
        content: [{ type: 'text', text: result.error?.message || 'Plum assistant request failed' }],
        isError: true,
      };
    if (
      ['plum_read_task_image', 'plum_read_task_upload'].includes(params.name) &&
      result.data?.image
    )
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ filename: result.data.filename, path: result.data.path }),
          },
          { type: 'image', mimeType: result.data.image.mimeType, data: result.data.image.data },
        ],
      };
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data) }],
      structuredContent: { data: result.data },
    };
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: 'Plum assistant backend is not reachable. Retry when the session backend is available.',
        },
      ],
      isError: true,
    };
  }
}
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  void (async () => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON' } });
      return;
    }
    if (msg.id === undefined) return;
    let result;
    switch (msg.method) {
      case 'initialize':
        result = {
          protocolVersion: ['2025-11-25', '2025-06-18', '2024-11-05'].includes(
            msg.params?.protocolVersion
          )
            ? msg.params.protocolVersion
            : '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'plum-assistant', version: '1.0.0' },
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOL_LIST };
        break;
      case 'tools/call':
        result = await callTool(msg.params);
        break;
      default:
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
        return;
    }
    send({ jsonrpc: '2.0', id: msg.id, result });
  })().catch(() =>
    send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } })
  );
});
