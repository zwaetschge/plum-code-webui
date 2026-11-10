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
// The model card counts the discovered runnable models against the curated
// menu (PiModelMenuPicker): all of them, or "n von m" once a pick is stored.
assert.match(
  settingsPage,
  /Model menu<\/p>[\s\S]*?piMenuCount !== null\s*\?\s*`\$\{piMenuCount\} von \$\{piDiagnostic\.modelCount\} im Menü`\s*:\s*`Alle \$\{piDiagnostic\.modelCount\} Modelle im Menü`/,
  'Pi settings must surface the discovered runnable model count'
);
assert.match(
  settingsPage,
  /piDiagnostic && piDiagnostic\.modelCount > 0 \? \(\s*<PiModelMenuPicker\s+models=\{piDiagnostic\.models\}[\s\S]*?cliProviderModelLists: \{[\s\S]*?pi: list,/,
  'the discovered models must feed the Pi model menu picker, which saves the Pi menu list'
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
