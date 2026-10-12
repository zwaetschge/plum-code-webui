import { Router } from 'express';
/** Public signing fingerprints only; no credential or placeholder certificate is ever published. */
export function androidAppLinks(environment:NodeJS.ProcessEnv=process.env) {
  const certificates=(environment.PLUM_ANDROID_APP_LINK_FINGERPRINTS || '').split(',').map(value=>value.trim().toUpperCase()).filter(Boolean);
  if (!certificates.length || certificates.some(value=>!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) return [];
  return [{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'com.claudewebui.app',sha256_cert_fingerprints:[...new Set(certificates)]}}];
}
const router=Router();
router.get('/assetlinks.json',(_req,res)=>{res.setHeader('Cache-Control','public, max-age=300');res.json(androidAppLinks());});
export default router;
