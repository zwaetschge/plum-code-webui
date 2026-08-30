#!/usr/bin/env node
// Minimal MCP stdio server: exposes image generation tools backed by Plum
// Code WebUI's internal ComfyUI service. Three tools cover T2I (fast/quality)
// and image edit, each mapping 1:1 to a workflow template baked into the backend.
//
// All actual ComfyUI talk happens in the backend (services/comfyui/*). This
// process is a thin bridge so workflow definitions, the ComfyUI URL, and the
// auth path stay in one place — change the URL in WebUI Settings and every
// new CLI session picks it up without restart.
//
// Speaks JSON-RPC 2.0 over stdin/stdout, no external deps.

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const BACKEND = process.env.WEBUI_BACKEND_URL || 'http://localhost:3001';
const HOOK_SECRET = process.env.WEBUI_HOOK_SECRET || '';
const SESSION_ID = process.env.WEBUI_SESSION_ID || '';
const SESSION_CONTEXT_FILE = process.env.WEBUI_SESSION_CONTEXT_FILE || '';
const TIMEOUT_S = Number(process.env.COMFYUI_TIMEOUT_SECONDS || 300);

const log = (...args) => console.error('[mcp-comfyui]', ...args);

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}
function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
}

const ASPECTS = [
  '1:1 (Perfect Square)',
  '2:3 (Classic Portrait)',
  '3:2 (Golden Landscape)',
  '3:4 (Golden Ratio)',
  '4:3 (Classic Landscape)',
  '4:5 (Artistic Frame)',
  '5:4 (Balanced Frame)',
  '9:16 (Slim Vertical)',
  '16:9 (Panorama)',
  '9:21 (Ultra Tall)',
  '21:9 (Epic Ultrawide)',
];
const MEGAPIXELS = ['0.1', '0.25', '0.5', '1.0', '1.5', '2.0'];

// Shared parameter schema used by all three tools. Edit-only fields are
// added to the edit tool below.
const COMMON_PROPS = {
  prompt: {
    type: 'string',
    description:
      'Visual description of the image. Be specific about subject, style, colors, composition.',
    minLength: 3,
    maxLength: 4000,
  },
  aspect_ratio: {
    type: 'string',
    description: 'Aspect ratio preset. Defaults to "1:1 (Perfect Square)".',
    enum: ASPECTS,
  },
  megapixel: {
    type: 'string',
    description:
      'Image size in megapixels. "0.5" chat-preview, "1.0"/"2.0" full quality. Bigger = slower.',
    enum: MEGAPIXELS,
  },
  steps: {
    type: 'integer',
    description: 'Sampling steps. Fewer = faster. Defaults set per workflow (8-9 typically).',
    minimum: 1,
    maximum: 60,
  },
  seed: {
    type: 'integer',
    description: 'Optional seed for reproducible output. Omit for random.',
    minimum: 0,
  },
  cfg: {
    type: 'number',
    description:
      'CFG scale. Defaults to 1 — these workflows are CFG-1 distilled, change with care.',
  },
  sampler_name: {
    type: 'string',
    description:
      'Override the sampler (euler, dpmpp_2m_sde, etc). Leave unset for workflow default.',
  },
};

// Both `input_image` and `mask` pass the backend's ownership gate, which exists
// so ComfyUI cannot be turned into a file-exfiltration relay. The gate accepts
// exactly two roots, and naming them here saves the agent a failed call.
const IMAGE_PATH_PROP = {
  type: 'string',
  description:
    "Absolute path under this session's workspace `.claude-webui-attachments/` (or `.claude-webui-images/`), " +
    'or an owned Plum-generated image path/URL (`/generated/<uuid>.png`). Any other path is rejected — ' +
    'copy the file into `.claude-webui-attachments/` first. PNG/JPEG/WebP/GIF up to 25 MB.',
  minLength: 1,
};

const TOOLS = [
  {
    name: 'generate_image',
    description: [
      'Generate an image via Z-Image Turbo (fast T2I). ~5s/image, lower VRAM.',
      'After this tool returns, paste the `display_markdown` field into your reply so the image renders inline in chat.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: COMMON_PROPS,
    },
  },
  {
    name: 'generate_image_quality',
    description: [
      'Generate an image via Flux.2 Klein 9B + Turbo LoRA (quality T2I, ~8 steps).',
      'Use this when the user wants higher fidelity / more detail than `generate_image` provides.',
      'After this tool returns, paste the `display_markdown` field into your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: COMMON_PROPS,
    },
  },
  {
    name: 'edit_image',
    description: [
      'Edit an existing image via Flux.2 Klein image-to-image (ReferenceLatent).',
      'Pass an absolute path to a local image file as `input_image` — the backend automatically uploads it to ComfyUI before running the workflow.',
      'After this tool returns, paste the `display_markdown` field into your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt', 'input_image'],
      properties: {
        ...COMMON_PROPS,
        input_image: IMAGE_PATH_PROP,
      },
    },
  },
  {
    name: 'inpaint_image',
    description: [
      'Masked edit: repaint ONLY the white area of `mask` and leave every other pixel bit-identical.',
      'This is the tool for surgical work — remove an object, replace a background, change one garment —',
      'because `edit_image` re-renders the whole frame and silently shifts everything else.',
      'Build the mask yourself with ImageMagick (same size as the source, white = repaint, black = keep),',
      'write it next to the source under .claude-webui-attachments/, then pass both paths here.',
      'After this tool returns, paste the `display_markdown` field into your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt', 'input_image', 'mask'],
      properties: {
        ...COMMON_PROPS,
        input_image: IMAGE_PATH_PROP,
        mask: {
          ...IMAGE_PATH_PROP,
          description:
            'Greyscale mask, same pixel dimensions as `input_image`: white = repaint, black = keep. ' +
            IMAGE_PATH_PROP.description,
        },
        mask_blend_pixels: {
          type: 'number',
          description:
            'Feather width of the seam in pixels (default 32). Raise it when the transition shows, lower it for hard edges like text.',
          minimum: 0,
          maximum: 256,
        },
        mask_expand_pixels: {
          type: 'number',
          description:
            'Grow the mask outward before repainting (default 0). Use 4-16 when a hard ImageMagick threshold sits exactly on the object edge and leaves a halo.',
          minimum: 0,
          maximum: 512,
        },
        mask_invert: {
          type: 'boolean',
          description: 'Repaint the black area instead of the white one.',
        },
      },
    },
  },
];

const WORKFLOW_BY_TOOL = {
  generate_image: 'krea2-t2i',
  generate_image_quality: 'flux2-klein-t2i',
  edit_image: 'f2k-edit',
  inpaint_image: 'f2k-inpaint',
};

// Discovery + guidance tools, following the official Comfy MCP conventions
// (search_templates / get_template_schema / get_prompting_guide): agents can
// inspect what exists before generating instead of relying on tool names.
TOOLS.push(
  {
    name: 'list_workflows',
    description:
      'List the ComfyUI workflow templates this server can run: id, title, description, defaults and accepted parameters. Read-only; use it to choose between speed, quality and edit variants.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_prompting_guide',
    description:
      'Prompting recommendations per workflow family (Krea2, Flux.2 Klein, Z-Image). Read-only; consult before writing prompts for best results.',
    inputSchema: { type: 'object', properties: {} },
  }
);

const PROMPTING_GUIDE = [
  '# Prompting guide (Plum ComfyUI workflows)',
  '',
  '## generate_image — Krea2 Turbo (default T2I)',
  '- The prompt is used verbatim: no refinement pass, no LoRA trigger words.',
  '- Describe subject, style, lighting, colors and composition explicitly.',
  '- 8 steps, euler/simple; CFG is distilled to 1 — do not raise it.',
  '',
  '## generate_image_quality — Flux.2 Klein 9B + Turbo LoRA',
  '- Handles longer, denser prompts and fine detail better than the fast path.',
  '- Natural-language sentences outperform keyword soup on Flux models.',
  '- 8 steps, CFG 1 distilled; changing sampler rarely helps.',
  '',
  '## edit_image — Flux.2 Klein image-to-image (ReferenceLatent)',
  '- `input_image` is required; the prompt describes the desired RESULT, not the change delta.',
  '- Keep the prompt aligned with what should stay: unmentioned traits may drift.',
  '- It re-renders the WHOLE frame. Nothing is preserved exactly, not even untouched regions,',
  '  and the canvas may be resized by a few pixels. For a targeted change use `inpaint_image`.',
  '',
  '## inpaint_image — masked crop & stitch (surgical edits)',
  '- Everything outside the mask is copied from the source, so the change is auditable:',
  '  `magick compare -metric AE source result null:` should report only the masked pixels.',
  '- The prompt describes what belongs INSIDE the mask, plus enough context to blend',
  '  ("weathered brick wall, same afternoon light"), not the edit instruction.',
  '- Build the mask with ImageMagick, e.g. a region: ',
  '  `magick -size WxH xc:black -fill white -draw "roundrectangle x1,y1 x2,y2 12,12" mask.png`,',
  '  or from colour: `magick src.png -fuzz 18% -fill white -opaque "#3a5f2b" -fill black +opaque white mask.png`.',
  '- Blur the mask (`-blur 0x8`) OR raise `mask_blend_pixels`; doing both over-softens the seam.',
  '- If a thin halo of the old content survives, raise `mask_expand_pixels` to 8-16.',
  '- Very small masks still render at working resolution, so a 60px mask is fine.',
  '',
  '## General',
  '- megapixel "0.5" for chat previews, "1.0"–"2.0" for final quality.',
  '- Pass `seed` to reproduce or iterate on a specific result.',
].join('\n');

async function callBackendGet(path) {
  const headers = {};
  const sessionId = getSessionId();
  if (HOOK_SECRET) headers['x-webui-hook-secret'] = HOOK_SECRET;
  if (sessionId) headers['x-webui-session-id'] = sessionId;
  const resp = await fetch(`${BACKEND}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await resp.json();
  if (!resp.ok || !body.success) {
    throw new Error(body?.error?.message || `HTTP ${resp.status}`);
  }
  return body.data;
}

function getSessionId() {
  if (SESSION_ID) return SESSION_ID;
  if (!SESSION_CONTEXT_FILE) return '';
  try {
    const parsed = JSON.parse(readFileSync(SESSION_CONTEXT_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return '';
    if (Date.now() - Number(parsed.updatedAt || 0) > 6 * 60 * 60 * 1000) return '';
    return typeof parsed.webuiSessionId === 'string' ? parsed.webuiSessionId : '';
  } catch {
    return '';
  }
}

async function callBackend(workflow, params) {
  const headers = {
    'content-type': 'application/json',
  };
  const sessionId = getSessionId();
  if (HOOK_SECRET) headers['x-webui-hook-secret'] = HOOK_SECRET;
  if (sessionId) headers['x-webui-session-id'] = sessionId;

  const resp = await fetch(`${BACKEND}/api/comfyui/internal/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ workflow, params }),
    signal: AbortSignal.timeout((TIMEOUT_S + 10) * 1000),
  });
  const text = await resp.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`backend non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
  }
  if (!resp.ok || !body.success) {
    const msg = body?.error?.message || `HTTP ${resp.status}`;
    throw new Error(`generation failed: ${msg}`);
  }
  return body.data;
}

async function runTool(name, args) {
  const workflow = WORKFLOW_BY_TOOL[name];
  if (!workflow) throw new Error(`unknown tool: ${name}`);

  const prompt = String(args?.prompt || '').trim();
  if (prompt.length < 3) throw new Error('prompt must be at least 3 characters');

  const params = { prompt };
  if (args?.aspect_ratio) params.aspect_ratio = args.aspect_ratio;
  if (args?.megapixel) params.megapixel = String(args.megapixel);
  if (Number.isInteger(args?.steps)) params.steps = args.steps;
  if (Number.isInteger(args?.seed)) params.seed = args.seed;
  if (typeof args?.cfg === 'number') params.cfg = args.cfg;
  if (args?.sampler_name) params.sampler_name = args.sampler_name;
  if (args?.input_image) params.input_image = args.input_image;
  if (args?.mask) params.mask = args.mask;
  if (typeof args?.mask_blend_pixels === 'number')
    params.mask_blend_pixels = args.mask_blend_pixels;
  if (typeof args?.mask_expand_pixels === 'number')
    params.mask_expand_pixels = args.mask_expand_pixels;
  if (typeof args?.mask_invert === 'boolean') params.mask_invert = args.mask_invert;
  log('submit', { tool: name, workflow, prompt: prompt.slice(0, 80) });

  const data = await callBackend(workflow, params);

  if (data.status !== 'completed' || !data.outputUrl) {
    throw new Error(`generation did not complete: ${data.error || data.status}`);
  }

  const altText = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
  const markdown = `![${altText}](${data.outputUrl})`;

  log('done', { tool: name, url: data.outputUrl, seed: data.seed });

  return {
    content: [
      {
        type: 'text',
        text: [
          `Image generated and saved.`,
          `url: ${data.outputUrl}`,
          `filename: ${data.outputFilename}`,
          `seed: ${data.seed ?? 'unknown'}`,
          `workflow: ${workflow}`,
          ``,
          `display_markdown: ${markdown}`,
          ``,
          `NEXT STEP: include the display_markdown line above in your reply to the user so the image renders inline in the chat.`,
        ].join('\n'),
      },
    ],
    structuredContent: {
      url: data.outputUrl,
      filename: data.outputFilename,
      seed: data.seed ?? null,
      workflow,
      display_markdown: markdown,
    },
  };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mcp-comfyui', version: '0.2.0' },
      });
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return; // no response for notifications
    }
    if (method === 'tools/list') {
      return result(id, { tools: TOOLS });
    }
    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};
      if (toolName === 'get_prompting_guide') {
        return result(id, { content: [{ type: 'text', text: PROMPTING_GUIDE }] });
      }
      if (toolName === 'list_workflows') {
        try {
          const data = await callBackendGet('/api/comfyui/internal/workflows');
          return result(id, {
            content: [{ type: 'text', text: JSON.stringify(data.workflows, null, 2) }],
            structuredContent: data,
          });
        } catch (e) {
          return result(id, {
            content: [{ type: 'text', text: `Error: ${e.message}` }],
            isError: true,
          });
        }
      }
      if (!WORKFLOW_BY_TOOL[toolName]) {
        return error(id, -32601, `unknown tool: ${toolName}`);
      }
      try {
        const r = await runTool(toolName, args);
        return result(id, r);
      } catch (e) {
        log('tool error', e.message);
        return result(id, {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        });
      }
    }
    return error(id, -32601, `method not found: ${method}`);
  } catch (e) {
    log('handler error', e.message);
    return error(id, -32603, e.message);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    log('parse error', e.message, line.slice(0, 200));
    return;
  }
  void handleRequest(msg);
});

log(`ready (backend=${BACKEND}, session=${getSessionId() || '<unset>'})`);
