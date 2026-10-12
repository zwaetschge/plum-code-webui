/**
 * ComfyUI workflow templates baked into the WebUI.
 *
 * Each template is a frozen JSON object matching ComfyUI's `/prompt` endpoint
 * schema (node-id-keyed graph). `buildWorkflow()` deep-clones the template and
 * overlays user-supplied parameters onto the appropriate node fields.
 *
 * Text-to-image is Krea2 only; every image-input workflow is Qwen-Image 2.1:
 *   - `krea2-t2i`        — default T2I via Krea2 Turbo
 *   - `qwen21-edit`      — instruction edit via Qwen-Image 2.1
 *   - `qwen21-inpaint`   — masked crop & stitch edit via Qwen-Image 2.1
 *   - `qwen21-pixelart`  — pixel-art sprite redraw via Qwen-Image 2.1
 *
 * Adding a new workflow: copy the ComfyUI "Save (API Format)" JSON into TEMPLATES,
 * declare the parameter map below, and surface it in routes/comfyui.ts.
 */

export type WorkflowId = 'krea2-t2i' | 'qwen21-edit' | 'qwen21-inpaint' | 'qwen21-pixelart';

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
  /** The prompt is an optional hint (pixel-art: who the sprite is). */
  promptOptional?: boolean;
}

export const WORKFLOWS: Record<WorkflowId, WorkflowMeta> = {
  'krea2-t2i': {
    id: 'krea2-t2i',
    title: 'Krea2 Turbo (default T2I)',
    description:
      'Text-to-image via Krea2 Turbo INT8 ConvRot + qwen3vl_4b CLIP. 8 steps, euler/simple. ' +
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
  'qwen21-edit': {
    id: 'qwen21-edit',
    title: 'Qwen-Image 2.1 (image edit, default)',
    description:
      'Instruction edit via Qwen-Image 2.1 INT8: the input image goes to TextEncodeQwenImage21 ' +
      'as `<image1>` (Qwen3-VL sees it, its VAE latent is spliced in) and the encoder latent ' +
      'sets the canvas, so the output follows the input aspect ratio. Write the change as an ' +
      'instruction ("Make the cape red, keep everything else"). Re-renders the whole frame; ' +
      '`megapixel` sets the pixel budget, `aspect_ratio` is ignored. Output may carry an alpha ' +
      'channel (the model can edit transparency). ~45 s at 1 MP, ~90 s at 2 MP.',
    kind: 'edit',
    defaults: {
      steps: 25,
      cfg: 1,
      megapixel: '2.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
  },
  'qwen21-inpaint': {
    id: 'qwen21-inpaint',
    title: 'Qwen-Image 2.1 (masked inpaint, crop & stitch)',
    description:
      'Masked edit via Qwen-Image 2.1 INT8. Crops the masked region at 1024 px, edits the crop ' +
      'with the prompt as instruction, and stitches it back, so every pixel outside the mask ' +
      'survives bit-identical. Needs `input_image` and `mask` (white = repaint). Output keeps ' +
      'the source resolution; `megapixel` and `aspect_ratio` are ignored.',
    kind: 'edit',
    defaults: {
      steps: 25,
      cfg: 1,
      megapixel: '1.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
    requiresMask: true,
  },
  'qwen21-pixelart': {
    id: 'qwen21-pixelart',
    title: 'Qwen-Image 2.1 Pixel-Art Upscaler',
    description:
      'Redraws a pixel-art sprite as a clean high-resolution illustration. Snaps the sprite to ' +
      'its native pixel grid and lets Qwen-Image 2.1 redraw it in edit mode, with the sprite as ' +
      'reference image, so pose, colors, expression and props stay faithful. `prompt` is optional ' +
      'and names the character (e.g. "Squirtle, the Pokemon"), which gives the best results for ' +
      'known figures; leave it empty for own characters. Transparent PNGs get a white background. ' +
      '~30 s at 1 MP, ~90 s at 2 MP.',
    kind: 'edit',
    defaults: {
      steps: 25,
      cfg: 1,
      megapixel: '1.0',
      aspect_ratio: '1:1 (Perfect Square)',
      sampler_name: 'euler',
      scheduler: 'simple',
    },
    requiresInputImage: true,
    promptOptional: true,
  },
};

// ── Templates (frozen — buildWorkflow always deep-clones) ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workflow = Record<string, any>;

// ── Krea2 templates ──────────────────────────────────────────────────────
// Transcribed verbatim from the ComfyUI API exports the Krea2 client
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
    // The FP8 checkpoint was removed from the server; the INT8 ConvRot file needs
    // the OneTrainer W8A8 loader (core UNETLoader rejects its quant format).
    inputs: {
      unet_name: 'Krea2-Turbo-int8-ConvRot.safetensors',
      weight_dtype: 'default',
      model_type: 'krea2',
      on_the_fly_quantization: false,
      enable_convrot: true,
      lora_mode: 'Dynamic',
    },
    class_type: 'OTUNetLoaderW8A8',
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
    // Off: no LoRA is loaded here, so its trigger words must not reach the prompt.
    inputs: {
      value: false,
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

/** Shared Qwen-Image 2.1 INT8 loader nodes for the edit/inpaint templates. */
const QWEN21_LOADERS: Workflow = {
  '1': { inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, class_type: 'VAELoader' },
  '4': {
    inputs: {
      clip_name: 'qwen3vl_8b_int8_convrot.safetensors',
      type: 'qwen_image',
      device: 'default',
    },
    class_type: 'CLIPLoader',
  },
  '12': {
    inputs: { unet_name: 'qwen-image-2.1-UC-int8_convrot.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
  },
  '13': {
    inputs: { device: 'auto', dtype: 'default', model: ['12', 0] },
    class_type: 'QwenImage21Cache',
  },
};

/**
 * Qwen-Image 2.1 instruction edit (official ComfyUI template, prompt enhancer
 * off). TextEncodeQwenImage21 sees the input as `<image1>` and emits positive,
 * negative and the canvas latent; the sampler runs at denoise 1 on that latent.
 * `resolution` is the encoder's edge length (pixels ≈ resolution²), filled from
 * `megapixel` by translateValue.
 */
const QWEN21_EDIT_TEMPLATE: Workflow = {
  ...QWEN21_LOADERS,
  '10': { inputs: { image: 'input.png' }, class_type: 'LoadImage' },
  '2': {
    inputs: {
      prompt: 'Keep the image unchanged.',
      negative_prompt: '',
      resolution: 1440,
      clip: ['4', 0],
      'images.image_1': ['10', 0],
      vae: ['1', 0],
    },
    class_type: 'TextEncodeQwenImage21',
  },
  '7': {
    inputs: {
      seed: 0,
      steps: 25,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['13', 0],
      positive: ['2', 0],
      negative: ['2', 1],
      latent_image: ['2', 2],
    },
    class_type: 'KSampler',
  },
  '8': { inputs: { samples: ['7', 0], vae: ['1', 0] }, class_type: 'VAEDecode' },
  '11': { inputs: { filename_prefix: 'Qwen21-Edit', images: ['8', 0] }, class_type: 'SaveImage' },
};

/**
 * Qwen-Image 2.1 masked inpaint: InpaintCropImproved crop & stitch around a Qwen
 * edit of the 1024 px crop (`resolution: 0`
 * keeps the crop size, so the stitcher gets a same-sized image). The 2.1 VAE
 * decodes RGBA; SplitImageWithAlpha drops alpha because InpaintStitchImproved
 * needs RGB.
 */
const QWEN21_INPAINT_TEMPLATE: Workflow = {
  ...QWEN21_LOADERS,
  '10': { inputs: { image: 'input.png' }, class_type: 'LoadImage' },
  '20': { inputs: { image: 'mask.png', channel: 'red' }, class_type: 'LoadImageMask' },
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
  },
  '2': {
    inputs: {
      prompt: 'Keep the image unchanged.',
      negative_prompt: '',
      resolution: 0,
      clip: ['4', 0],
      'images.image_1': ['21', 1],
      vae: ['1', 0],
    },
    class_type: 'TextEncodeQwenImage21',
  },
  '7': {
    inputs: {
      seed: 0,
      steps: 25,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['13', 0],
      positive: ['2', 0],
      negative: ['2', 1],
      latent_image: ['2', 2],
    },
    class_type: 'KSampler',
  },
  '79': { inputs: { samples: ['7', 0], vae: ['1', 0] }, class_type: 'VAEDecode' },
  '80': { inputs: { image: ['79', 0] }, class_type: 'SplitImageWithAlpha' },
  '22': {
    inputs: { stitcher: ['21', 0], inpainted_image: ['80', 0] },
    class_type: 'InpaintStitchImproved',
  },
  '11': {
    inputs: { filename_prefix: 'Qwen21-Inpaint', images: ['22', 0] },
    class_type: 'SaveImage',
  },
};

/**
 * Qwen-Image 2.1 Pixel-Art Upscaler (ComfyUI user workflow
 * `Qwen21-PixelArt-Upscaler.json`). PixelArtPrepXBRZ only snaps the sprite to its
 * native grid (`native_preview`, nearest; xBRZ smoothing made Qwen soft) and fills
 * transparency white. TextEncodeQwenImage21 feeds it as `<image1>` to the edit
 * model; its latent output sets the canvas, so the sampler runs at denoise 1.
 * Node 8 is the optional "who is this?" name; nodes 10-12 build
 * "<image1> shows NAME. <instruction>" and drop the sentence when the name is
 * empty. `megapixel` maps to the encoder `resolution` (see translateValue).
 * The workflow's optional correction pass is left out of the template.
 */
const QWEN21_PIXELART_TEMPLATE: Workflow = {
  '1': { inputs: { image: 'meowth_sprite.png' }, class_type: 'LoadImage' },
  '2': {
    inputs: {
      native_width: 0,
      xbrz_factor: 1,
      megapixels: 1,
      background: '#FFFFFF',
      image: ['1', 0],
      mask: ['1', 1],
    },
    class_type: 'PixelArtPrepXBRZ',
  },
  '3': {
    inputs: { unet_name: 'qwen-image-2.1-UC-int8_convrot.safetensors', weight_dtype: 'default' },
    class_type: 'UNETLoader',
  },
  '4': {
    inputs: { device: 'auto', dtype: 'default', model: ['3', 0] },
    class_type: 'QwenImage21Cache',
  },
  '5': {
    inputs: {
      clip_name: 'qwen3vl_8b_int8_convrot.safetensors',
      type: 'qwen_image',
      device: 'default',
    },
    class_type: 'CLIPLoader',
  },
  '6': { inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }, class_type: 'VAELoader' },
  '8': { inputs: { value: '' }, class_type: 'PrimitiveStringMultiline' },
  '9': {
    inputs: {
      value:
        'Redraw <image1> as a crisp high-resolution 2D cartoon illustration of exactly ' +
        'the same character: same pose, proportions, colors, facial expression and ' +
        'background composition. Replace the blocky low-resolution pixel look with smooth ' +
        'clean bold dark outlines, flat cel shading with subtle soft highlights and sharp ' +
        'vector edges. No pixels, no stair-stepped edges, no blur.',
    },
    class_type: 'PrimitiveStringMultiline',
  },
  '10': {
    inputs: { string_a: '<image1> shows ', string_b: ['8', 0], delimiter: '' },
    class_type: 'StringConcatenate',
  },
  '11': {
    inputs: { string_a: ['10', 0], string_b: ['9', 0], delimiter: '. ' },
    class_type: 'StringConcatenate',
  },
  '12': {
    inputs: {
      string: ['11', 0],
      regex_pattern: '^<image1> shows\\s*\\.\\s*',
      replace: '',
      case_insensitive: true,
      multiline: false,
      dotall: false,
      count: 0,
    },
    class_type: 'RegexReplace',
  },
  '13': {
    inputs: {
      prompt: ['12', 0],
      negative_prompt: '',
      resolution: 1024,
      clip: ['5', 0],
      'images.image_1': ['2', 1],
      vae: ['6', 0],
    },
    class_type: 'TextEncodeQwenImage21',
  },
  '14': {
    inputs: {
      seed: 42,
      steps: 25,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['4', 0],
      positive: ['13', 0],
      negative: ['13', 1],
      latent_image: ['13', 2],
    },
    class_type: 'KSampler',
  },
  '15': { inputs: { samples: ['14', 0], vae: ['6', 0] }, class_type: 'VAEDecode' },
  '16': {
    inputs: { filename_prefix: 'Qwen21-PixelUpscale', images: ['15', 0] },
    class_type: 'SaveImage',
  },
};

const TEMPLATES: Record<WorkflowId, Workflow> = {
  'krea2-t2i': KREA2_T2I_TEMPLATE,
  'qwen21-edit': QWEN21_EDIT_TEMPLATE,
  'qwen21-inpaint': QWEN21_INPAINT_TEMPLATE,
  'qwen21-pixelart': QWEN21_PIXELART_TEMPLATE,
};

// Per-workflow map: which node holds which parameter. Each entry is
// `[node_id, field_path_in_inputs]`. Field paths are dot-separated for nested
// fields (e.g. `seed` is at `inputs.seed`, just `seed`).
const PARAM_MAP: Record<
  WorkflowId,
  Partial<Record<keyof WorkflowParams, [nodeId: string, field: string]>>
> = {
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
  'qwen21-edit': {
    prompt: ['2', 'prompt'],
    negative_prompt: ['2', 'negative_prompt'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    // Pixel budget of the edit canvas; translated to the encoder's edge length.
    megapixel: ['2', 'resolution'],
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    input_image: ['10', 'image'],
    filename_prefix: ['11', 'filename_prefix'],
  },
  'qwen21-inpaint': {
    prompt: ['2', 'prompt'],
    negative_prompt: ['2', 'negative_prompt'],
    seed: ['7', 'seed'],
    steps: ['7', 'steps'],
    cfg: ['7', 'cfg'],
    sampler_name: ['7', 'sampler_name'],
    scheduler: ['7', 'scheduler'],
    // No `megapixel` / `aspect_ratio`: the crop sizes itself and the stitch restores the frame.
    unet: ['12', 'unet_name'],
    clip: ['4', 'clip_name'],
    vae: ['1', 'vae_name'],
    input_image: ['10', 'image'],
    mask: ['20', 'image'],
    mask_blend_pixels: ['21', 'mask_blend_pixels'],
    mask_expand_pixels: ['21', 'mask_expand_pixels'],
    mask_invert: ['21', 'mask_invert'],
    filename_prefix: ['11', 'filename_prefix'],
  },
  'qwen21-pixelart': {
    // The prompt is the optional "who is this?" name (node 8).
    prompt: ['8', 'value'],
    seed: ['14', 'seed'],
    steps: ['14', 'steps'],
    cfg: ['14', 'cfg'],
    sampler_name: ['14', 'sampler_name'],
    scheduler: ['14', 'scheduler'],
    // Pixel budget of the edit canvas; translated to the encoder's edge length.
    megapixel: ['13', 'resolution'],
    unet: ['3', 'unet_name'],
    clip: ['5', 'clip_name'],
    vae: ['6', 'vae_name'],
    input_image: ['1', 'image'],
    filename_prefix: ['16', 'filename_prefix'],
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
  // TextEncodeQwenImage21 takes an edge length (pixels ~ resolution², multiple of 32).
  if ((id === 'qwen21-pixelart' || id === 'qwen21-edit') && field === 'resolution') {
    const mp = Number(value);
    if (Number.isFinite(mp) && mp > 0) return Math.round((Math.sqrt(mp) * 1024) / 32) * 32;
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

  const prompt = (params.prompt ?? '').trim();
  if (meta.promptOptional ? prompt.length > 0 && prompt.length < 3 : prompt.length < 3) {
    return { ok: false, error: 'prompt must be at least 3 characters' };
  }
  if (prompt.length > 4000) {
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
