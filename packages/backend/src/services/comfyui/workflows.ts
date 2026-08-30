/**
 * ComfyUI workflow templates baked into the WebUI.
 *
 * Each template is a frozen JSON object matching ComfyUI's `/prompt` endpoint
 * schema (node-id-keyed graph). `buildWorkflow()` deep-clones the template and
 * overlays user-supplied parameters onto the appropriate node fields.
 *
 * Three workflows ship out of the box:
 *   - `z-image-turbo`      — fast T2I via Z-Image Turbo (Lumina2 / qwen3_4b CLIP)
 *   - `flux2-klein-t2i`    — quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache
 *   - `flux2-klein-edit`   — image-to-image edit via Flux.2 Klein + reference latent
 *
 * Adding a new workflow: copy the ComfyUI "Save (API Format)" JSON into TEMPLATES,
 * declare the parameter map below, and surface it in routes/comfyui.ts.
 */

export type WorkflowId =
  | 'z-image-turbo'
  | 'flux2-klein-t2i'
  | 'flux2-klein-edit'
  | 'krea2-t2i'
  | 'f2k-edit'
  | 'f2k-inpaint';

export const VALID_ASPECTS = [
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
] as const;
export type AspectRatio = (typeof VALID_ASPECTS)[number];

export const VALID_MEGAPIXELS = ['0.1', '0.25', '0.5', '1.0', '1.5', '2.0'] as const;
export type Megapixels = (typeof VALID_MEGAPIXELS)[number];

export interface WorkflowParams {
  prompt: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler_name?: string;
  scheduler?: string;
  megapixel?: Megapixels;
  aspect_ratio?: AspectRatio;
  // Optional model swaps — defaults baked into each template.
  unet?: string;
  clip?: string;
  vae?: string;
  // LoRA override (Flux workflows only).
  lora_name?: string;
  lora_strength?: number;
  // TeaCache tuning (Flux workflows only).
  teacache_threshold?: number;
  // Image-edit workflow only — filename already uploaded to ComfyUI's `/input/`.
  input_image?: string;
  // Inpaint workflow only — greyscale mask, same filename rules as `input_image`.
  // White = repaint, black = keep. Resolved through the same ownership check.
  mask?: string;
  // Mask shaping, applied before the crop. `blend` feathers the seam, `expand`
  // grows the mask outward (useful when a hard ImageMagick threshold sits
  // exactly on the object edge and would otherwise leave a halo).
  mask_blend_pixels?: number;
  mask_expand_pixels?: number;
  mask_invert?: boolean;
  // Output prefix for ComfyUI's SaveImage node.
  filename_prefix?: string;
}

interface WorkflowMeta {
  id: WorkflowId;
  title: string;
  description: string;
  kind: 't2i' | 'edit';
  defaults: Required<
    Pick<WorkflowParams, 'steps' | 'cfg' | 'megapixel' | 'aspect_ratio' | 'sampler_name'>
  > & { scheduler?: string };
  requiresInputImage: boolean;
  requiresMask?: boolean;
}

export const WORKFLOWS: Record<WorkflowId, WorkflowMeta> = {
  'z-image-turbo': {
    id: 'z-image-turbo',
    title: 'Z-Image Turbo (fast T2I)',
    description: 'Fast text-to-image via Z-Image Turbo + qwen3_4b CLIP. ~5s/image, lower VRAM.',
    kind: 't2i',
    defaults: {
      steps: 9,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'dpmpp_2m_sde',
      scheduler: 'beta',
    },
    requiresInputImage: false,
  },
  'flux2-klein-t2i': {
    id: 'flux2-klein-t2i',
    title: 'Flux.2 Klein 9B (quality T2I)',
    description:
      'High-quality T2I via Flux.2 Klein 9B + Turbo LoRA + TeaCache. ~8 steps, qwen3_8b CLIP.',
    kind: 't2i',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
    },
    requiresInputImage: false,
  },
  'krea2-t2i': {
    id: 'krea2-t2i',
    title: 'Krea2 Turbo (default T2I)',
    description:
      'Text-to-image via Krea2 Turbo FP8 + qwen3vl_4b CLIP. 8 steps, euler/simple. ' +
      'Prompt refinement and LoRA trigger slots ship disabled — the prompt is used verbatim.',
    kind: 't2i',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '1.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: false,
  },
  'f2k-edit': {
    id: 'f2k-edit',
    title: 'Flux.2 Klein (image edit, current)',
    description:
      'Image edit via Flux.2 Klein 9B + Turbo LoRA and dual ReferenceLatent. ' +
      'Pass an `input_image` already uploaded to ComfyUI.',
    kind: 'edit',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
  },
  'flux2-klein-edit': {
    id: 'flux2-klein-edit',
    title: 'Flux.2 Klein 9B (image edit, TeaCache variant)',
    description:
      'Image-to-image edit via Flux.2 Klein + ReferenceLatent. Pass an `input_image` already uploaded to ComfyUI.',
    kind: 'edit',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
  },
  'f2k-inpaint': {
    id: 'f2k-inpaint',
    title: 'Flux.2 Klein (masked inpaint, crop & stitch)',
    description:
      'Masked edit via Flux.2 Klein 9B + Turbo LoRA. Crops the masked region at ' +
      'working resolution, repaints only there, and stitches it back, so every ' +
      'pixel outside the mask survives bit-identical — unlike `f2k-edit`, which ' +
      're-renders the whole frame. Needs `input_image` and `mask` ' +
      '(white = repaint). Output keeps the source resolution; `megapixel` and ' +
      '`aspect_ratio` are ignored.',
    kind: 'edit',
    defaults: {
      steps: 8,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
    requiresMask: true,
  },
};

// ── Templates (frozen — buildWorkflow always deep-clones) ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workflow = Record<string, any>;

const Z_IMAGE_TURBO_TEMPLATE: Workflow = {
  '60': {
    inputs: { filename_prefix: 'z-image', images: ['59:8', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '67': {
    inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '74': {
    inputs: {
      megapixel: '2.0',
      aspect_ratio: '9:16 (Slim Vertical)',
      divisible_by: '64',
      custom_ratio: false,
      custom_aspect_ratio: '1:1',
    },
    class_type: 'FluxResolutionNode',
    _meta: { title: 'Flux Resolution Calc' },
  },
  '59:29': {
    inputs: { vae_name: 'ae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '59:28': {
    inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '59:11': {
    inputs: { shift: 3, model: ['59:28', 0] },
    class_type: 'ModelSamplingAuraFlow',
    _meta: { title: 'ModelSamplingAuraFlow' },
  },
  '59:27': {
    inputs: { text: '"insert prompt here"', clip: ['67', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Prompt)' },
  },
  '59:13': {
    inputs: { width: ['74', 0], height: ['74', 1], batch_size: 1 },
    class_type: 'EmptySD3LatentImage',
    _meta: { title: 'EmptySD3LatentImage' },
  },
  '59:33': {
    inputs: { conditioning: ['59:27', 0] },
    class_type: 'ConditioningZeroOut',
    _meta: { title: 'ConditioningZeroOut' },
  },
  '59:3': {
    inputs: {
      seed: 0,
      steps: 9,
      cfg: 1,
      sampler_name: 'dpmpp_2m_sde',
      scheduler: 'beta',
      denoise: 1,
      model: ['59:11', 0],
      positive: ['59:27', 0],
      negative: ['59:33', 0],
      latent_image: ['59:13', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
  },
  '59:8': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 32,
      temporal_overlap: 16,
      samples: ['59:3', 0],
      vae: ['59:29', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
};

const FLUX2_KLEIN_T2I_TEMPLATE: Workflow = {
  '81': {
    inputs: {
      noise: ['113', 0],
      guider: ['112', 0],
      sampler: ['111', 0],
      sigmas: ['92', 0],
      latent_image: ['94', 0],
    },
    class_type: 'SamplerCustomAdvanced',
    _meta: { title: 'SamplerCustomAdvanced' },
  },
  '82': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 64,
      temporal_overlap: 8,
      samples: ['81', 0],
      vae: ['114', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
  '84': {
    inputs: { text: '', clip: ['102', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Negative Prompt)' },
  },
  '91': {
    inputs: { text: '"insert prompt here"', clip: ['102', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
  },
  '92': {
    inputs: { steps: 8, width: ['93', 0], height: ['93', 1] },
    class_type: 'Flux2Scheduler',
    _meta: { title: 'Flux2Scheduler' },
  },
  '93': {
    inputs: {
      megapixel: '2.0',
      aspect_ratio: '9:16 (Slim Vertical)',
      divisible_by: '64',
      custom_ratio: false,
      custom_aspect_ratio: '1:1',
    },
    class_type: 'FluxResolutionNode',
    _meta: { title: 'Flux Resolution Calc' },
  },
  '94': {
    inputs: { width: ['93', 0], height: ['93', 1], batch_size: 1 },
    class_type: 'EmptyFlux2LatentImage',
    _meta: { title: 'Empty Flux 2 Latent' },
  },
  '95': {
    inputs: { filename_prefix: 'ComfyUI', images: ['82', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '100': {
    inputs: { unet_name: 'flux-2-klein-base-9b.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '102': {
    inputs: { clip_name: 'qwen_3_8b_fp8mixed.safetensors', type: 'flux2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '105': {
    inputs: {
      model_type: 'flux',
      rel_l1_thresh: 0.4,
      start_percent: 0,
      end_percent: 1,
      cache_device: 'cuda',
      model: ['129', 0],
    },
    class_type: 'TeaCache',
    _meta: { title: 'TeaCache (Flux)' },
  },
  '111': {
    inputs: { sampler_name: 'euler' },
    class_type: 'KSamplerSelect',
    _meta: { title: 'KSamplerSelect' },
  },
  '112': {
    inputs: { cfg: 1, model: ['105', 0], positive: ['91', 0], negative: ['84', 0] },
    class_type: 'CFGGuider',
    _meta: { title: 'CFGGuider' },
  },
  '113': {
    inputs: { noise_seed: 0 },
    class_type: 'RandomNoise',
    _meta: { title: 'RandomNoise' },
  },
  '114': {
    inputs: { vae_name: 'flux2-vae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '129': {
    inputs: {
      lora_name: 'f2k/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['100', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load LoRA' },
  },
};

const FLUX2_KLEIN_EDIT_TEMPLATE: Workflow = {
  '1': {
    inputs: { vae_name: 'flux2-vae.safetensors' },
    class_type: 'VAELoader',
    _meta: { title: 'Load VAE' },
  },
  '2': {
    inputs: { text: '"Insert prompt to edit input image here"', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Positive Prompt)' },
  },
  '3': {
    inputs: { text: '', clip: ['4', 0] },
    class_type: 'CLIPTextEncode',
    _meta: { title: 'CLIP Text Encode (Negative - unused at CFG 1)' },
  },
  '4': {
    inputs: { clip_name: 'qwen_3_8b_fp8mixed.safetensors', type: 'flux2', device: 'default' },
    class_type: 'CLIPLoader',
    _meta: { title: 'Load CLIP' },
  },
  '5': {
    inputs: { upscale_method: 'lanczos', megapixels: 2, resolution_steps: 1, image: ['10', 0] },
    class_type: 'ImageScaleToTotalPixels',
    _meta: { title: 'ImageScaleToTotalPixels' },
  },
  '6': {
    inputs: {
      tile_size: 512,
      overlap: 64,
      temporal_size: 64,
      temporal_overlap: 8,
      samples: ['7', 0],
      vae: ['1', 0],
    },
    class_type: 'VAEDecodeTiled',
    _meta: { title: 'VAE Decode (Tiled)' },
  },
  '7': {
    inputs: {
      seed: 0,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['13', 0],
      positive: ['9:77', 0],
      negative: ['9:76', 0],
      latent_image: ['8', 0],
    },
    class_type: 'KSampler',
    _meta: { title: 'KSampler' },
  },
  '8': {
    inputs: { width: ['16', 0], height: ['16', 1], batch_size: 1 },
    class_type: 'EmptyFlux2LatentImage',
    _meta: { title: 'Empty Flux 2 Latent' },
  },
  '10': {
    inputs: { image: 'placeholder.png' },
    class_type: 'LoadImage',
    _meta: { title: 'Load Image' },
  },
  '11': {
    inputs: { filename_prefix: 'ComfyUI', images: ['6', 0] },
    class_type: 'SaveImage',
    _meta: { title: 'Save Image' },
  },
  '12': {
    inputs: { unet_name: 'flux-2-klein-base-9b.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
    _meta: { title: 'Load Diffusion Model' },
  },
  '13': {
    inputs: {
      model_type: 'flux',
      rel_l1_thresh: 0.4,
      start_percent: 0,
      end_percent: 1,
      cache_device: 'cuda',
      model: ['15', 0],
    },
    class_type: 'TeaCache',
    _meta: { title: 'TeaCache (Flux)' },
  },
  '15': {
    inputs: {
      lora_name: 'f2k/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['12', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: { title: 'Load LoRA' },
  },
  '16': {
    inputs: { image: ['5', 0] },
    class_type: 'GetImageSize',
    _meta: { title: 'Get Image Size' },
  },
  '9:78': {
    inputs: { pixels: ['5', 0], vae: ['1', 0] },
    class_type: 'VAEEncode',
    _meta: { title: 'VAE Encode' },
  },
  '9:77': {
    inputs: { conditioning: ['2', 0], latent: ['9:78', 0] },
    class_type: 'ReferenceLatent',
    _meta: { title: 'ReferenceLatent' },
  },
  '9:76': {
    inputs: { conditioning: ['3', 0], latent: ['9:78', 0] },
    class_type: 'ReferenceLatent',
    _meta: { title: 'ReferenceLatent' },
  },
};

// ── Krea2 / F2K templates ────────────────────────────────────────────────
// Transcribed verbatim from the ComfyUI API exports the Krea2/F2K client
// ships, so a workflow update here is a file copy rather than a rewrite.

const KREA2_T2I_TEMPLATE: Workflow = {
  '29': {
    inputs: {
      filename_prefix: 'Krea2-FP8-LoRA',
      images: ['30:8', 0],
    },
    class_type: 'SaveImage',
    _meta: {
      title: 'Save Image',
    },
  },
  '49': {
    inputs: {
      aspect_ratio: '16:9 (Widescreen)',
      megapixels: 1,
      multiple: 8,
    },
    class_type: 'ResolutionSelector',
    _meta: {
      title: 'Resolution Selector',
    },
  },
  '30:3': {
    inputs: {
      seed: 735915477938686,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['30:10', 0],
      positive: ['30:6', 0],
      negative: ['30:13', 0],
      latent_image: ['30:5', 0],
    },
    class_type: 'KSampler',
    _meta: {
      title: 'KSampler',
    },
  },
  '30:5': {
    inputs: {
      width: ['49', 0],
      height: ['49', 1],
      batch_size: 1,
    },
    class_type: 'EmptyLatentImage',
    _meta: {
      title: 'Empty Latent Image',
    },
  },
  '30:6': {
    inputs: {
      text: ['30:65', 0],
      clip: ['30:11', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: {
      title: 'CLIP Text Encode (Prompt)',
    },
  },
  '30:8': {
    inputs: {
      samples: ['30:3', 0],
      vae: ['30:12', 0],
    },
    class_type: 'VAEDecode',
    _meta: {
      title: 'VAE Decode',
    },
  },
  '30:10': {
    inputs: {
      unet_name: 'krea2_turbo_fp8_scaled.safetensors',
      weight_dtype: 'default',
    },
    class_type: 'UNETLoader',
    _meta: {
      title: 'Load Diffusion Model',
    },
  },
  '30:11': {
    inputs: {
      clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
      type: 'krea2',
      device: 'default',
    },
    class_type: 'CLIPLoader',
    _meta: {
      title: 'Load CLIP',
    },
  },
  '30:12': {
    inputs: {
      vae_name: 'qwen_image_vae.safetensors',
    },
    class_type: 'VAELoader',
    _meta: {
      title: 'Load VAE',
    },
  },
  '30:13': {
    inputs: {
      conditioning: ['30:6', 0],
    },
    class_type: 'ConditioningZeroOut',
    _meta: {
      title: 'ConditioningZeroOut',
    },
  },
  '30:16': {
    inputs: {
      prompt: ['30:17', 0],
      max_length: 512,
      sampling_mode: 'on',
      'sampling_mode.temperature': 0.7,
      'sampling_mode.top_k': 64,
      'sampling_mode.top_p': 0.95,
      'sampling_mode.min_p': 0.05,
      'sampling_mode.repetition_penalty': 1.05,
      'sampling_mode.seed': 0,
      'sampling_mode.presence_penalty': 0,
      thinking: false,
      use_default_template: true,
      clip: ['30:11', 0],
    },
    class_type: 'TextGenerate',
    _meta: {
      title: 'Generate Text',
    },
  },
  '30:17': {
    inputs: {
      string_a: ['30:18', 0],
      string_b: ['30:19', 0],
      delimiter: '',
    },
    class_type: 'StringConcatenate',
    _meta: {
      title: 'Concatenate Text',
    },
  },
  '30:18': {
    inputs: {
      value:
        'You are an expert prompt engineer for text-to-image models. Your task is to expand the user\'s prompt into a highly effective image-generation prompt.\n\nThink step by step about the request before writing the answer:\n- What is the subject and mood?\n- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.\n- What composition, framing, and grounded details will help the text-to-image model?\n\nThen output a single expanded prompt paragraph.\n\nFollow these rules strictly:\n1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.\n2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.\n3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.\n4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.\n5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.\n6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.\n7. **Respect Existing Detail:** If the user\'s prompt is already detailed, lightly polish and finalize rather than heavily expanding — preserve their phrasing and direction.\n8. **Respect the Human Form:** Treat depictions of people with dignity. Assume clothing covers genitals and intimate anatomy.\n9. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty — match the user\'s stated intent.\n\nUser\'s Input:\n\n',
    },
    class_type: 'PrimitiveStringMultiline',
    _meta: {
      title: 'Text String (System Prompt)',
    },
  },
  '30:19': {
    inputs: {
      value:
        'A cinematic 16:9 editorial photograph of a rain-soaked neon street at night, a lone figure in a dark coat standing beneath a glowing sign, wet asphalt reflections, monochrome ink wash style, dramatic contrast, crisp subject detail, atmospheric depth.',
    },
    class_type: 'PrimitiveStringMultiline',
    _meta: {
      title: 'Text String (User Prompt)',
    },
  },
  '30:20': {
    inputs: {
      source: ['30:21', 0],
    },
    class_type: 'PreviewAny',
    _meta: {
      title: 'Preview as Text',
    },
  },
  '30:21': {
    inputs: {
      switch: ['30:24', 0],
      on_false: ['30:19', 0],
      on_true: ['30:16', 0],
    },
    class_type: 'ComfySwitchNode',
    _meta: {
      title: 'Switch',
    },
  },
  '30:23': {
    inputs: {
      value: true,
    },
    class_type: 'PrimitiveBoolean',
    _meta: {
      title: 'Boolean (Enable LoRA?)',
    },
  },
  '30:24': {
    inputs: {
      value: false,
    },
    class_type: 'PrimitiveBoolean',
    _meta: {
      title: 'Boolean (Refine Prompt?)',
    },
  },
  '30:27': {
    inputs: {
      string_a: ['30:20', 0],
      string_b: 'monochrome ink wash style',
      delimiter: ', ',
    },
    class_type: 'StringConcatenate',
    _meta: {
      title: 'Concatenate Text (LoRA Trigger Word)',
    },
  },
  '30:28': {
    inputs: {
      switch: ['30:23', 0],
      on_false: ['30:20', 0],
      on_true: ['30:27', 0],
    },
    class_type: 'ComfySwitchNode',
    _meta: {
      title: 'Switch',
    },
  },
  '30:53': {
    inputs: {
      value: false,
    },
    class_type: 'PrimitiveBoolean',
    _meta: {
      title: 'Boolean (Enable LoRA? Slot 2)',
    },
  },
  '30:54': {
    inputs: {
      string_a: ['30:28', 0],
      string_b: 'monochrome stippling style',
      delimiter: ', ',
    },
    class_type: 'StringConcatenate',
    _meta: {
      title: 'Concatenate Text (LoRA Trigger Word 2)',
    },
  },
  '30:55': {
    inputs: {
      switch: ['30:53', 0],
      on_false: ['30:28', 0],
      on_true: ['30:54', 0],
    },
    class_type: 'ComfySwitchNode',
    _meta: {
      title: 'Switch (LoRA Trigger 2)',
    },
  },
  '30:58': {
    inputs: {
      value: false,
    },
    class_type: 'PrimitiveBoolean',
    _meta: {
      title: 'Boolean (Enable LoRA? Slot 3)',
    },
  },
  '30:59': {
    inputs: {
      string_a: ['30:55', 0],
      string_b: 'textured abstract style',
      delimiter: ', ',
    },
    class_type: 'StringConcatenate',
    _meta: {
      title: 'Concatenate Text (LoRA Trigger Word 3)',
    },
  },
  '30:60': {
    inputs: {
      switch: ['30:58', 0],
      on_false: ['30:55', 0],
      on_true: ['30:59', 0],
    },
    class_type: 'ComfySwitchNode',
    _meta: {
      title: 'Switch (LoRA Trigger 3)',
    },
  },
  '30:63': {
    inputs: {
      value: false,
    },
    class_type: 'PrimitiveBoolean',
    _meta: {
      title: 'Boolean (Enable LoRA? Slot 4)',
    },
  },
  '30:64': {
    inputs: {
      string_a: ['30:60', 0],
      string_b: 'purple retro anime style',
      delimiter: ', ',
    },
    class_type: 'StringConcatenate',
    _meta: {
      title: 'Concatenate Text (LoRA Trigger Word 4)',
    },
  },
  '30:65': {
    inputs: {
      switch: ['30:63', 0],
      on_false: ['30:60', 0],
      on_true: ['30:64', 0],
    },
    class_type: 'ComfySwitchNode',
    _meta: {
      title: 'Switch (LoRA Trigger 4)',
    },
  },
};

const F2K_EDIT_TEMPLATE: Workflow = {
  '1': {
    inputs: {
      vae_name: 'flux2-vae.safetensors',
    },
    class_type: 'VAELoader',
    _meta: {
      title: 'Load VAE',
    },
  },
  '2': {
    inputs: {
      text: "a woman assumes the identical pose from the reference image — matching the original figure's body position, posture, weight distribution, limb angles, hand placement, and gaze direction with precision. She wears the exact same outfit from the reference image, every garment, accessory, fabric texture, fold, drape, and fit reproduced identically on her frame. The lighting, environment, and atmosphere match the original scene. Shot on 35mm film with shallow depth of field.",
      clip: ['4', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: {
      title: 'CLIP Text Encode (Positive Prompt)',
    },
  },
  '3': {
    inputs: {
      text: '',
      clip: ['4', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: {
      title: 'CLIP Text Encode (Negative - unused at CFG 1)',
    },
  },
  '4': {
    inputs: {
      clip_name: 'qwen_3_8b_fp8mixed.safetensors',
      type: 'flux2',
      device: 'default',
    },
    class_type: 'CLIPLoader',
    _meta: {
      title: 'Load CLIP',
    },
  },
  '5': {
    inputs: {
      upscale_method: 'lanczos',
      megapixels: 2,
      resolution_steps: 1,
      image: ['10', 0],
    },
    class_type: 'ImageScaleToTotalPixels',
    _meta: {
      title: 'Scale Image to Total Pixels',
    },
  },
  '7': {
    inputs: {
      seed: 310778855344884,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['15', 0],
      positive: ['9:77', 0],
      negative: ['9:76', 0],
      latent_image: ['8', 0],
    },
    class_type: 'KSampler',
    _meta: {
      title: 'KSampler',
    },
  },
  '8': {
    inputs: {
      width: ['16', 0],
      height: ['16', 1],
      batch_size: 1,
    },
    class_type: 'EmptyFlux2LatentImage',
    _meta: {
      title: 'Empty Flux 2 Latent',
    },
  },
  '10': {
    inputs: {
      image: '(m=qOL97SYbeaSaaTbaAaaaa)(mh=5YVGCSKGMfRnI6z1)0.jpg',
    },
    class_type: 'LoadImage',
    _meta: {
      title: 'Load Image',
    },
  },
  '11': {
    inputs: {
      filename_prefix: 'ComfyUI',
      images: ['79', 0],
    },
    class_type: 'SaveImage',
    _meta: {
      title: 'Save Image',
    },
  },
  '12': {
    inputs: {
      unet_name: 'flux-2-klein-base-9b.safetensors',
      weight_dtype: 'default',
    },
    class_type: 'UNETLoader',
    _meta: {
      title: 'Load Diffusion Model',
    },
  },
  '15': {
    inputs: {
      lora_name: 'f2k/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['12', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: {
      title: 'Turbo LoRA (fest)',
    },
  },
  '16': {
    inputs: {
      image: ['5', 0],
    },
    class_type: 'GetImageSize',
    _meta: {
      title: 'Get Image Size',
    },
  },
  '79': {
    inputs: {
      samples: ['7', 0],
      vae: ['1', 0],
    },
    class_type: 'VAEDecode',
    _meta: {
      title: 'VAE Decode',
    },
  },
  '9:78': {
    inputs: {
      pixels: ['5', 0],
      vae: ['1', 0],
    },
    class_type: 'VAEEncode',
    _meta: {
      title: 'VAE Encode',
    },
  },
  '9:77': {
    inputs: {
      conditioning: ['2', 0],
      latent: ['9:78', 0],
    },
    class_type: 'ReferenceLatent',
    _meta: {
      title: 'ReferenceLatent',
    },
  },
  '9:76': {
    inputs: {
      conditioning: ['3', 0],
      latent: ['9:78', 0],
    },
    class_type: 'ReferenceLatent',
    _meta: {
      title: 'ReferenceLatent',
    },
  },
};

// Masked inpaint. Same model stack as F2K_EDIT_TEMPLATE, but the diffusion path
// runs on a crop around the mask instead of the whole frame:
//   10 LoadImage ─┐
//   20 LoadImageMask ─┴→ 21 InpaintCropImproved → (stitcher, crop, cropped mask)
//                                 crop → VAEEncode → ReferenceLatent → KSampler
//                                 → VAEDecode → 22 InpaintStitchImproved(stitcher)
// The stitcher replays the recorded geometry, so pixels outside the (feathered)
// mask come straight from the source. No ImageScaleToTotalPixels here — the
// output must keep the source resolution, which is the whole point.
const F2K_INPAINT_TEMPLATE: Workflow = {
  '1': {
    inputs: {
      vae_name: 'flux2-vae.safetensors',
    },
    class_type: 'VAELoader',
    _meta: {
      title: 'Load VAE',
    },
  },
  '2': {
    inputs: {
      text: 'a photograph',
      clip: ['4', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: {
      title: 'CLIP Text Encode (Positive Prompt)',
    },
  },
  '3': {
    inputs: {
      text: '',
      clip: ['4', 0],
    },
    class_type: 'CLIPTextEncode',
    _meta: {
      title: 'CLIP Text Encode (Negative - unused at CFG 1)',
    },
  },
  '4': {
    inputs: {
      clip_name: 'qwen_3_8b_fp8mixed.safetensors',
      type: 'flux2',
      device: 'default',
    },
    class_type: 'CLIPLoader',
    _meta: {
      title: 'Load CLIP',
    },
  },
  '7': {
    inputs: {
      seed: 310778855344884,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['15', 0],
      positive: ['9:77', 0],
      negative: ['9:76', 0],
      latent_image: ['8', 0],
    },
    class_type: 'KSampler',
    _meta: {
      title: 'KSampler',
    },
  },
  '8': {
    inputs: {
      width: ['16', 0],
      height: ['16', 1],
      batch_size: 1,
    },
    class_type: 'EmptyFlux2LatentImage',
    _meta: {
      title: 'Empty Flux 2 Latent',
    },
  },
  '10': {
    inputs: {
      image: 'input.png',
    },
    class_type: 'LoadImage',
    _meta: {
      title: 'Load Image',
    },
  },
  '11': {
    inputs: {
      filename_prefix: 'ComfyUI',
      images: ['22', 0],
    },
    class_type: 'SaveImage',
    _meta: {
      title: 'Save Image',
    },
  },
  '12': {
    inputs: {
      unet_name: 'flux-2-klein-base-9b.safetensors',
      weight_dtype: 'default',
    },
    class_type: 'UNETLoader',
    _meta: {
      title: 'Load Diffusion Model',
    },
  },
  '15': {
    inputs: {
      lora_name: 'f2k/concept/klein_9B_Turbo_r128.safetensors',
      strength_model: 1,
      model: ['12', 0],
    },
    class_type: 'LoraLoaderModelOnly',
    _meta: {
      title: 'Turbo LoRA (fest)',
    },
  },
  '16': {
    inputs: {
      image: ['21', 1],
    },
    class_type: 'GetImageSize',
    _meta: {
      title: 'Get Image Size (of crop)',
    },
  },
  '20': {
    inputs: {
      image: 'mask.png',
      channel: 'red',
    },
    class_type: 'LoadImageMask',
    _meta: {
      title: 'Load Mask',
    },
  },
  '21': {
    inputs: {
      image: ['10', 0],
      mask: ['20', 0],
      downscale_algorithm: 'bilinear',
      upscale_algorithm: 'bicubic',
      preresize: false,
      preresize_mode: 'ensure minimum resolution',
      preresize_min_width: 1024,
      preresize_min_height: 1024,
      preresize_max_width: 16384,
      preresize_max_height: 16384,
      mask_fill_holes: true,
      mask_expand_pixels: 0,
      mask_invert: false,
      mask_blend_pixels: 32,
      mask_hipass_filter: 0.1,
      extend_for_outpainting: false,
      extend_up_factor: 1,
      extend_down_factor: 1,
      extend_left_factor: 1,
      extend_right_factor: 1,
      context_from_mask_extend_factor: 1.2,
      output_resize_to_target_size: true,
      output_target_width: 1024,
      output_target_height: 1024,
      output_padding: '32',
      device_mode: 'gpu (much faster)',
    },
    class_type: 'InpaintCropImproved',
    _meta: {
      title: 'Inpaint Crop',
    },
  },
  '22': {
    inputs: {
      stitcher: ['21', 0],
      inpainted_image: ['79', 0],
    },
    class_type: 'InpaintStitchImproved',
    _meta: {
      title: 'Inpaint Stitch',
    },
  },
  '79': {
    inputs: {
      samples: ['7', 0],
      vae: ['1', 0],
    },
    class_type: 'VAEDecode',
    _meta: {
      title: 'VAE Decode',
    },
  },
  '9:78': {
    inputs: {
      pixels: ['21', 1],
      vae: ['1', 0],
    },
    class_type: 'VAEEncode',
    _meta: {
      title: 'VAE Encode',
    },
  },
  '9:77': {
    inputs: {
      conditioning: ['2', 0],
      latent: ['9:78', 0],
    },
    class_type: 'ReferenceLatent',
    _meta: {
      title: 'ReferenceLatent',
    },
  },
  '9:76': {
    inputs: {
      conditioning: ['3', 0],
      latent: ['9:78', 0],
    },
    class_type: 'ReferenceLatent',
    _meta: {
      title: 'ReferenceLatent',
    },
  },
};

const TEMPLATES: Record<WorkflowId, Workflow> = {
  'z-image-turbo': Z_IMAGE_TURBO_TEMPLATE,
  'flux2-klein-t2i': FLUX2_KLEIN_T2I_TEMPLATE,
  'flux2-klein-edit': FLUX2_KLEIN_EDIT_TEMPLATE,
  'krea2-t2i': KREA2_T2I_TEMPLATE,
  'f2k-edit': F2K_EDIT_TEMPLATE,
  'f2k-inpaint': F2K_INPAINT_TEMPLATE,
};

// Per-workflow map: which node holds which parameter. Each entry is
// `[node_id, field_path_in_inputs]`. Field paths are dot-separated for nested
// fields (e.g. `lora_name` is at `inputs.lora_name`, just `lora_name`).
const PARAM_MAP: Record<
  WorkflowId,
  Partial<Record<keyof WorkflowParams, [nodeId: string, field: string]>>
> = {
  'z-image-turbo': {
    prompt: ['59:27', 'text'],
    seed: ['59:3', 'seed'],
    steps: ['59:3', 'steps'],
    cfg: ['59:3', 'cfg'],
    sampler_name: ['59:3', 'sampler_name'],
    scheduler: ['59:3', 'scheduler'],
    megapixel: ['74', 'megapixel'],
    aspect_ratio: ['74', 'aspect_ratio'],
    unet: ['59:28', 'unet_name'],
    clip: ['67', 'clip_name'],
    vae: ['59:29', 'vae_name'],
    filename_prefix: ['60', 'filename_prefix'],
  },
  'flux2-klein-t2i': {
    prompt: ['91', 'text'],
    negative_prompt: ['84', 'text'],
    seed: ['113', 'noise_seed'],
    steps: ['92', 'steps'],
    cfg: ['112', 'cfg'],
    sampler_name: ['111', 'sampler_name'],
    megapixel: ['93', 'megapixel'],
    aspect_ratio: ['93', 'aspect_ratio'],
    unet: ['100', 'unet_name'],
    clip: ['102', 'clip_name'],
    vae: ['114', 'vae_name'],
    lora_name: ['129', 'lora_name'],
    lora_strength: ['129', 'strength_model'],
    teacache_threshold: ['105', 'rel_l1_thresh'],
    filename_prefix: ['95', 'filename_prefix'],
  },
  'krea2-t2i': {
    // The prompt node feeds a switch chain (refiner, then LoRA trigger words)
    // before it reaches CLIPTextEncode, so the raw string belongs in 30:19.
    prompt: ['30:19', 'value'],
    seed: ['30:3', 'seed'],
    steps: ['30:3', 'steps'],
    cfg: ['30:3', 'cfg'],
    sampler_name: ['30:3', 'sampler_name'],
    scheduler: ['30:3', 'scheduler'],
    megapixel: ['49', 'megapixels'],
    aspect_ratio: ['49', 'aspect_ratio'],
    unet: ['30:10', 'unet_name'],
    clip: ['30:11', 'clip_name'],
    vae: ['30:12', 'vae_name'],
    filename_prefix: ['29', 'filename_prefix'],
  },
  'f2k-edit': {
    prompt: ['2', 'text'],
    negative_prompt: ['3', 'text'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    megapixel: ['5', 'megapixels'],
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    lora_name: ['15', 'lora_name'],
    lora_strength: ['15', 'strength_model'],
    input_image: ['10', 'image'],
    filename_prefix: ['11', 'filename_prefix'],
  },
  'f2k-inpaint': {
    prompt: ['2', 'text'],
    negative_prompt: ['3', 'text'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    // Deliberately no `megapixel` / `aspect_ratio`: the crop sizes itself from
    // the mask and the stitch restores the source frame.
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    lora_name: ['15', 'lora_name'],
    lora_strength: ['15', 'strength_model'],
    input_image: ['10', 'image'],
    mask: ['20', 'image'],
    mask_blend_pixels: ['21', 'mask_blend_pixels'],
    mask_expand_pixels: ['21', 'mask_expand_pixels'],
    mask_invert: ['21', 'mask_invert'],
    filename_prefix: ['11', 'filename_prefix'],
  },
  'flux2-klein-edit': {
    prompt: ['2', 'text'],
    negative_prompt: ['3', 'text'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    megapixel: ['5', 'megapixels'],
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    lora_name: ['15', 'lora_name'],
    lora_strength: ['15', 'strength_model'],
    teacache_threshold: ['13', 'rel_l1_thresh'],
    input_image: ['10', 'image'],
    filename_prefix: ['11', 'filename_prefix'],
  },
};

/**
 * `ResolutionSelector` (Krea2) and `FluxResolutionNode` label the same ratios
 * differently — "1:1 (Square)" versus "1:1 (Perfect Square)". A label the combo
 * does not know is not rejected by ComfyUI: the prompt is accepted, the image
 * branch silently never runs, and the job reports success with no image. The
 * public vocabulary stays the Flux one; this translates on the way in.
 */
const RESOLUTION_SELECTOR_ASPECTS: Record<AspectRatio, string> = {
  '1:1 (Perfect Square)': '1:1 (Square)',
  '2:3 (Classic Portrait)': '2:3 (Portrait Photo)',
  '3:2 (Golden Landscape)': '3:2 (Photo)',
  '3:4 (Golden Ratio)': '3:4 (Portrait Standard)',
  '4:3 (Classic Landscape)': '4:3 (Standard)',
  // No 4:5 or 5:4 in the selector — the nearest portrait/landscape wins.
  '4:5 (Artistic Frame)': '3:4 (Portrait Standard)',
  '5:4 (Balanced Frame)': '4:3 (Standard)',
  '9:16 (Slim Vertical)': '9:16 (Portrait Widescreen)',
  '16:9 (Panorama)': '16:9 (Widescreen)',
  '9:21 (Ultra Tall)': '9:16 (Portrait Widescreen)',
  '21:9 (Epic Ultrawide)': '21:9 (Ultrawide)',
};

function translateValue(id: WorkflowId, field: string, value: unknown): unknown {
  if (id === 'krea2-t2i' && field === 'aspect_ratio' && typeof value === 'string') {
    return RESOLUTION_SELECTOR_ASPECTS[value as AspectRatio] ?? value;
  }
  return value;
}

function setField(workflow: Workflow, nodeId: string, field: string, value: unknown): void {
  const node = workflow[nodeId];
  if (!node || !node.inputs) return;
  // Megapixel for the edit workflow is numeric (ImageScaleToTotalPixels), but
  // string everywhere else (FluxResolutionNode). Coerce based on existing type.
  const current = node.inputs[field];
  if (typeof current === 'number' && typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      node.inputs[field] = n;
      return;
    }
  }
  node.inputs[field] = value;
}

/**
 * Generate a 64-bit-ish seed in the range ComfyUI accepts.
 * Default Math.random() only gives 53 bits but it's fine — RandomNoise wraps.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * Validate params against workflow constraints, throwing on bad input.
 */
export function validateParams(
  id: WorkflowId,
  params: WorkflowParams
): { ok: true } | { ok: false; error: string } {
  const meta = WORKFLOWS[id];
  if (!meta) return { ok: false, error: `unknown workflow: ${id}` };

  if (!params.prompt || params.prompt.trim().length < 3) {
    return { ok: false, error: 'prompt must be at least 3 characters' };
  }
  if (params.prompt.length > 4000) {
    return { ok: false, error: 'prompt exceeds 4000 chars' };
  }
  if (meta.requiresInputImage && !params.input_image) {
    return { ok: false, error: `${id} requires input_image (filename uploaded to ComfyUI)` };
  }
  if (meta.requiresMask && !params.mask) {
    return { ok: false, error: `${id} requires mask (greyscale image, white = repaint)` };
  }
  if (
    params.mask_blend_pixels !== undefined &&
    (params.mask_blend_pixels < 0 || params.mask_blend_pixels > 256)
  ) {
    return { ok: false, error: 'mask_blend_pixels must be 0-256' };
  }
  if (
    params.mask_expand_pixels !== undefined &&
    (params.mask_expand_pixels < 0 || params.mask_expand_pixels > 512)
  ) {
    return { ok: false, error: 'mask_expand_pixels must be 0-512' };
  }
  if (params.steps !== undefined && (params.steps < 1 || params.steps > 60)) {
    return { ok: false, error: 'steps must be 1-60' };
  }
  if (params.cfg !== undefined && (params.cfg < 0 || params.cfg > 20)) {
    return { ok: false, error: 'cfg must be 0-20' };
  }
  if (params.aspect_ratio && !VALID_ASPECTS.includes(params.aspect_ratio)) {
    return { ok: false, error: `aspect_ratio must be one of: ${VALID_ASPECTS.join(', ')}` };
  }
  if (params.megapixel && !VALID_MEGAPIXELS.includes(params.megapixel)) {
    return { ok: false, error: `megapixel must be one of: ${VALID_MEGAPIXELS.join(', ')}` };
  }
  if (
    params.lora_strength !== undefined &&
    (params.lora_strength < 0 || params.lora_strength > 2)
  ) {
    return { ok: false, error: 'lora_strength must be 0-2' };
  }
  return { ok: true };
}

/**
 * Deep-clone a workflow template and overlay user params onto the appropriate
 * nodes. Returns the workflow ready to POST to ComfyUI's /prompt endpoint.
 *
 * Unset params keep their template default. `seed` defaults to a random value
 * so repeated calls with the same prompt produce different images.
 */
export function buildWorkflow(id: WorkflowId, params: WorkflowParams): Workflow {
  const template = TEMPLATES[id];
  if (!template) throw new Error(`unknown workflow: ${id}`);

  const workflow: Workflow = JSON.parse(JSON.stringify(template));
  const map = PARAM_MAP[id];

  // Seed: random if not supplied so the user always gets variation.
  const seed = params.seed ?? randomSeed();

  const fullParams: WorkflowParams = { ...params, seed };

  for (const [paramKey, mapping] of Object.entries(map)) {
    if (!mapping) continue;
    const value = fullParams[paramKey as keyof WorkflowParams];
    if (value === undefined || value === null) continue;
    const [nodeId, field] = mapping;
    setField(workflow, nodeId, field, translateValue(id, field, value));
  }

  return workflow;
}

/**
 * Listing endpoint payload — describes each workflow's title, defaults, and
 * declared parameters so the frontend / agent can render or compose calls.
 */
export function listWorkflows(): Array<WorkflowMeta & { params: Array<keyof WorkflowParams> }> {
  return Object.values(WORKFLOWS).map((w) => ({
    ...w,
    params: Object.keys(PARAM_MAP[w.id]) as Array<keyof WorkflowParams>,
  }));
}
