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

function readParentEnv() {
  if (process.platform !== 'linux' || !process.ppid) return {};
  try {
    const raw = readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
    const entries = {};
    for (const item of raw.split('\0')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      if (separator <= 0) continue;
      entries[item.slice(0, separator)] = item.slice(separator + 1);
    }
    return entries;
  } catch {
    return {};
  }
}

// Codex starts MCP servers with the static config env block, which omits the
// dynamic WebUI session/auth env of the parent Codex process.
const RUNTIME_ENV = { ...readParentEnv(), ...process.env };

const BACKEND = RUNTIME_ENV.WEBUI_BACKEND_URL || 'http://localhost:3001';
const HOOK_SECRET = RUNTIME_ENV.WEBUI_HOOK_SECRET || '';
const SESSION_ID = RUNTIME_ENV.WEBUI_SESSION_ID || '';
const SESSION_CONTEXT_FILE = RUNTIME_ENV.WEBUI_SESSION_CONTEXT_FILE || '';
// A non-numeric COMFYUI_TIMEOUT_SECONDS used to yield NaN, and `setTimeout(NaN)`
// fires immediately - every generation would abort on the spot.
const TIMEOUT_S = (() => {
  const parsed = Number(process.env.COMFYUI_TIMEOUT_SECONDS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
})();

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
const EDIT_PROMPT_DESCRIPTION =
  'The change as an instruction, e.g. "Replace the shield with an open hand, same cartoon style". Name what must stay unchanged when it matters.';

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
    description:
      'Sampling steps. Fewer = faster. Defaults set per workflow (8 for Krea2, 25 for Qwen-Image 2.1).',
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
      'DEFAULT text-to-image: Krea2 Turbo, 8 steps, ~10-20 s. Use this for every text-to-image request; it is the only text-to-image tool.',
      'After this tool returns, paste the `display_markdown` field into your reply so the image renders inline in chat.',
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
      'Edit an existing image via Qwen-Image 2.1 (instruction edit; output follows the input aspect ratio).',
      'Write `prompt` as an instruction, e.g. "Make the cape red, keep everything else unchanged". Re-renders the whole frame; for a surgical change use `inpaint_image`. ~45 s at 1 MP, ~90 s at 2 MP.',
      'Pass an absolute path to a local image file as `input_image` — the backend automatically uploads it to ComfyUI before running the workflow.',
      'After this tool returns, paste the `display_markdown` field into your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['prompt', 'input_image'],
      properties: {
        ...COMMON_PROPS,
        prompt: { ...COMMON_PROPS.prompt, description: EDIT_PROMPT_DESCRIPTION },
        input_image: IMAGE_PATH_PROP,
      },
    },
  },
  {
    name: 'inpaint_image',
    description: [
      'Masked edit via Qwen-Image 2.1: repaint ONLY the white area of `mask` and leave every other pixel bit-identical.',
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
        prompt: { ...COMMON_PROPS.prompt, description: EDIT_PROMPT_DESCRIPTION },
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
  {
    name: 'upscale_pixel_art',
    description: [
      'Redraw a pixel-art sprite as a clean high-resolution illustration (Qwen-Image 2.1 Pixel-Art Upscaler).',
      'Snaps the sprite to its pixel grid and redraws it with Qwen-Image 2.1 in edit mode, so pose, colors, expression and props stay faithful. ~30 s at 1 MP, ~90 s at 2 MP.',
      'Works with tiny originals (e.g. 40x40) and already enlarged block-pixel images; transparent PNGs get a white background.',
      'For known characters pass `subject` (e.g. "Meowth, the Pokemon"): it is the biggest quality lever. Leave it out for original characters.',
      'After this tool returns, paste the `display_markdown` field into your reply.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['input_image'],
      properties: {
        input_image: IMAGE_PATH_PROP,
        subject: {
          type: 'string',
          description:
            'Optional: who or what the sprite is, or a short description of ambiguous details (e.g. "a knight with a blue cape").',
          maxLength: 400,
        },
        megapixel: COMMON_PROPS.megapixel,
        seed: COMMON_PROPS.seed,
      },
    },
  },
];

const WORKFLOW_BY_TOOL = {
  generate_image: 'krea2-t2i',
  edit_image: 'qwen21-edit',
  inpaint_image: 'qwen21-inpaint',
  upscale_pixel_art: 'qwen21-pixelart',
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
      'Prompting recommendations per workflow family (Krea2, Qwen-Image 2.1). Read-only; consult before writing prompts for best results.',
    inputSchema: { type: 'object', properties: {} },
  }
);

// Gemini image models ("Nano Banana") through the user's Google Antigravity
// subscription, the login Pi stores. Not ComfyUI, but the same output path and
// chat rendering, so it lives with the other image tools.
TOOLS.push({
  name: 'generate_image_gemini',
  description: [
    "Generate or edit an image with Google Gemini's image model (Nano Banana) through the user's Google Antigravity subscription (Pi login).",
    'Strong at prompt adherence, legible text in images, and editing or combining reference images (`input_images`).',
    'Takes 10-30 s and uses the Antigravity image quota. Fails if Antigravity is not connected; then use the ComfyUI tools instead.',
    'After this tool returns, paste the `display_markdown` field into your reply.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'What to create, or for edits what to change. Natural language; quote any text that must appear in the image.',
        minLength: 3,
        maxLength: 8000,
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        description:
          'Output aspect ratio. Omit to let the model choose (edits keep the input ratio).',
      },
      input_images: {
        type: 'array',
        maxItems: 6,
        description: 'Reference images to edit or combine (max 6).',
        items: IMAGE_PATH_PROP,
      },
    },
  },
});

async function runGeminiImage(args) {
  const prompt = String(args?.prompt || '').trim();
  if (prompt.length < 3) throw new Error('prompt must be at least 3 characters');
  const headers = { 'content-type': 'application/json' };
  const sessionId = getSessionId();
  if (HOOK_SECRET) headers['x-webui-hook-secret'] = HOOK_SECRET;
  if (sessionId) headers['x-webui-session-id'] = sessionId;
  log('submit', { tool: 'generate_image_gemini', prompt: prompt.slice(0, 80) });
  const resp = await fetch(`${BACKEND}/api/comfyui/internal/gemini-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      ...(args?.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
      ...(Array.isArray(args?.input_images) && args.input_images.length
        ? { inputImages: args.input_images.map(String) }
        : {}),
    }),
    signal: AbortSignal.timeout(200_000),
  });
  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body?.success) {
    throw new Error(body?.error?.message || `HTTP ${resp.status}`);
  }
  const data = body.data;
  const altText = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt;
  const markdown = `![${altText}](${data.outputUrl})`;
  log('done', { tool: 'generate_image_gemini', url: data.outputUrl, model: data.model });
  return {
    content: [
      {
        type: 'text',
        text: [
          'Image generated and saved.',
          `url: ${data.outputUrl}`,
          `filename: ${data.filename}`,
          `model: ${data.model} (Google Antigravity)`,
          ...(data.text ? [`model note: ${data.text}`] : []),
          '',
          `display_markdown: ${markdown}`,
          '',
          'NEXT STEP: include the display_markdown line above in your reply to the user so the image renders inline in the chat.',
        ].join('\n'),
      },
    ],
    structuredContent: {
      url: data.outputUrl,
      filename: data.filename,
      model: data.model,
      display_markdown: markdown,
    },
  };
}

const PROMPTING_GUIDE = [
  '# Prompting guide (Plum ComfyUI workflows)',
  '',
  '## generate_image — Krea2 Turbo (default T2I)',
  '- The prompt is used verbatim: no refinement pass, no LoRA trigger words.',
  '- Describe subject, style, lighting, colors and composition explicitly.',
  '- 8 steps, euler/simple; CFG is distilled to 1 — do not raise it.',
  '',
  '## edit_image — Qwen-Image 2.1 instruction edit',
  '- `input_image` is required; write the prompt as an INSTRUCTION ("Make the cape red"),',
  '  not as a description of the whole result. Say what must stay ("keep everything else unchanged").',
  '- The input is visible to the model as `<image1>`; you can refer to it ("the dog in <image1>").',
  '- It re-renders the WHOLE frame and follows the input aspect ratio; `megapixel` sets the size',
  '  ("1.0" ~45 s, "2.0" ~90 s), `aspect_ratio` is ignored. For a targeted change use `inpaint_image`.',
  '- 25 steps, CFG 1. More steps or CFG > 1 brought no visible gain in tests; CFG 3 doubles the time.',
  '- Output may carry an alpha channel: the model can make backgrounds transparent on request.',
  '',
  '## inpaint_image — Qwen-Image 2.1 masked crop & stitch (surgical edits)',
  '- Everything outside the mask is copied from the source, so the change is auditable:',
  '  `magick compare -metric AE source result null:` should report only the masked pixels.',
  '- The prompt is an instruction about the masked object ("Remove the shield; show his arm and',
  '  cape there instead, same style"). The model sees a 1024 px crop around the mask, not the whole image.',
  '- Build the mask with ImageMagick, e.g. a region: ',
  '  `magick -size WxH xc:black -fill white -draw "roundrectangle x1,y1 x2,y2 12,12" mask.png`,',
  '  or from colour: `magick src.png -fuzz 18% -fill white -opaque "#3a5f2b" -fill black +opaque white mask.png`.',
  '- Blur the mask (`-blur 0x8`) OR raise `mask_blend_pixels`; doing both over-softens the seam.',
  '- If a thin halo of the old content survives, raise `mask_expand_pixels` to 8-16.',
  '- Very small masks still render at working resolution, so a 60px mask is fine.',
  '',
  '## upscale_pixel_art — Qwen-Image 2.1 pixel-art redraw',
  '- Pass the character name as `subject` for known figures ("Squirtle, the Pokemon"); it gives the best results.',
  '- If the sprite itself is ambiguous (a pixel blob read as an extra item), fix it afterwards with `inpaint_image`',
  '  or `edit_image` ("Remove the second shield"); text in `subject` does not override the sprite shapes.',
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

  // The pixel-art upscaler takes an optional `subject` instead of a prompt.
  const optionalPrompt = workflow === 'qwen21-pixelart';
  const prompt = String((optionalPrompt ? args?.subject : args?.prompt) || '').trim();
  if (prompt.length < 3 && !(optionalPrompt && prompt.length === 0)) {
    throw new Error(`${optionalPrompt ? 'subject' : 'prompt'} must be at least 3 characters`);
  }

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

  const label = prompt || 'Pixel art redrawn in high resolution';
  const altText = label.length > 120 ? `${label.slice(0, 117)}...` : label;
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
      if (!WORKFLOW_BY_TOOL[toolName] && toolName !== 'generate_image_gemini') {
        return error(id, -32601, `unknown tool: ${toolName}`);
      }
      try {
        const r =
          toolName === 'generate_image_gemini'
            ? await runGeminiImage(args)
            : await runTool(toolName, args);
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
