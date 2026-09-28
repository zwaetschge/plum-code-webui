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
  /<TabsContent value="pi"[\s\S]*?onClick=\{\(\) => handleGeneralTabChange\('logins'\)\}[\s\S]*?Manage provider accounts/,
  'Pi settings must link to the shared provider account page'
);

console.log('Pi settings tab regression tests passed.');
