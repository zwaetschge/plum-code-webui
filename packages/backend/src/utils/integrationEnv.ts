import { getAppConfig } from '../db/index.js';

export async function buildIntegrationEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const chromiumPath = process.env.CHROME_BIN || '/usr/local/bin/plum-chromium';
  env.CHROME_BIN = chromiumPath;
  env.CHROMIUM_BIN = process.env.CHROMIUM_BIN || chromiumPath;
  env.CHROMIUM_PATH = process.env.CHROMIUM_PATH || chromiumPath;
  env.BROWSER = process.env.BROWSER || chromiumPath;
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromiumPath;
  env.PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || chromiumPath;
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || '1';
  env.PUPPETEER_SKIP_DOWNLOAD = process.env.PUPPETEER_SKIP_DOWNLOAD || '1';
  env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD || '1';

  const comfyuiUrl = await getAppConfig('comfyui_url');
  if (comfyuiUrl) {
    env.COMFYUI_URL = comfyuiUrl;
  }
  const loraTesterUrl = await getAppConfig('lora_tester_url');
  if (loraTesterUrl) {
    env.LORA_TESTER_URL = loraTesterUrl;
  }
  // OPENAI_API_KEY enables scripts/openai-image.sh inside CLI sessions. Source priority:
  //   1. app_config.openai_api_key
  //   2. parent process env
  const openaiKey = (await getAppConfig('openai_api_key')) || process.env.OPENAI_API_KEY;
  if (openaiKey) {
    env.OPENAI_API_KEY = openaiKey;
  }
  return env;
}
