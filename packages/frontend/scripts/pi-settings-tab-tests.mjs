import assert from 'node:assert/strict';
import fs from 'node:fs';

const settingsPage = fs.readFileSync(
  new URL('../src/pages/SettingsPage.tsx', import.meta.url),
  'utf8'
);

assert.match(
  settingsPage,
  /type GeneralSettingsTab =[\s\S]*\| 'pi'/,
  'Pi must remain a routable General settings tab'
);
assert.match(
  settingsPage,
  /value: 'pi',\s+label: 'Pi',[\s\S]*sections: \[\{ id: 'pi-cli', label: 'Pi' \}\]/,
  'the General settings navigation must expose Pi'
);
assert.match(
  settingsPage,
  /<TabsContent value="pi"[\s\S]*?<section id="pi-cli">/,
  'the Pi navigation entry must render a matching settings panel'
);
assert.match(
  settingsPage,
  /activeGeneralTab === 'pi'/,
  'opening Pi settings must load the user-specific provider diagnostics'
);
assert.match(
  settingsPage,
  /piDiagnostic\.modelCount[\s\S]*runnable models/,
  'Pi settings must surface the discovered runnable model count'
);
assert.match(
  settingsPage,
  /<TabsContent value="pi"[\s\S]*?onClick=\{\(\) => handleGeneralTabChange\('model-providers'\)\}[\s\S]*?Modellanbieter/,
  'Pi settings must link to the Modellanbieter registry'
);
assert.match(
  settingsPage,
  /<TabsContent value="model-providers"[\s\S]*?id="model-providers"[\s\S]*?<ModelProvidersPanel \/>/,
  'the Modellanbieter destination must render the registry panel'
);

const modelProvidersPanel = fs.readFileSync(
  new URL('../src/components/settings/ModelProvidersPanel.tsx', import.meta.url),
  'utf8'
);
assert.match(modelProvidersPanel, /const BASE_PATH = '\/api\/model-providers';/);
assert.doesNotMatch(modelProvidersPanel, /\/api\/opencode/);

console.log('Pi settings tab regression tests passed.');
