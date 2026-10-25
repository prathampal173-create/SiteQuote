import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { buildUnsentEstimateHtml } from './unsentPdf';
import { loadUnsentEstimate } from './unsentEstimateApi';
import { ESTIMATE_CHANGED_MESSAGE, matchesPreview, type UnsentEstimate } from './unsentEstimate';

export class StaleEstimateError extends Error {
  constructor() { super(ESTIMATE_CHANGED_MESSAGE); this.name = 'StaleEstimateError'; }
}
/**
 * Check a fresh SQL statement snapshot immediately before and after native PDF rendering.
 * If any relevant saved field changed, do not release an obsolete file to the UI.
 * The final Phase 3C prepare transaction MUST repeat this compare atomically when
 * creating its quote version; an independent PDF is not a locked database snapshot.
 */
export async function generateVerifiedUnsentPdf(
  accountId: string, projectId: string, preview: UnsentEstimate,
  dependencies: {
    load?: typeof loadUnsentEstimate;
    render?: (html: string) => Promise<{ uri: string }>;
    remove?: (uri: string) => void;
  } = {}
): Promise<string> {
  const load = dependencies.load ?? loadUnsentEstimate;
  const render = dependencies.render ?? (async (html: string) => Print.printToFileAsync({ html }));
  const remove = dependencies.remove ?? ((uri: string) => { new File(uri).delete(); });
  const before = await load(accountId, projectId);
  if (!matchesPreview(preview, before)) throw new StaleEstimateError();
  const { uri } = await render(buildUnsentEstimateHtml(preview));
  if (!uri.startsWith('file://') || !uri.toLowerCase().includes('.pdf')) {
    if (uri.startsWith('file://')) { try { remove(uri); } catch { /* best effort */ } }
    throw new Error('PDF renderer did not return a private PDF file.');
  }
  try {
    const after = await load(accountId, projectId);
    if (!matchesPreview(preview, after)) throw new StaleEstimateError();
    return uri;
  } catch (error) {
    try { remove(uri); } catch { /* private native cache may already be removed */ }
    throw error;
  }
}
