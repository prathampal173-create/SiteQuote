import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import type { PreparedQuote } from './preparedQuotes';
import { frozenEstimate, quoteReference } from './preparedQuotes';
import { buildUnsentEstimateHtml } from './unsentPdf';

export function buildVersionedQuoteHtml(q: PreparedQuote): string {
  // Neither the current project nor a live database read is consulted.
  return buildUnsentEstimateHtml(frozenEstimate(q), {
    reference: quoteReference(q),
    issueDate: new Date(q.issued_at).toLocaleDateString('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric'
    })
  });
}
export function removeQuotePdf(uri: string | null) {
  if (uri?.startsWith('file://')) { try { new File(uri).delete(); } catch { /* cache may be empty */ } }
}
export async function renderVersionedQuotePdf(q: PreparedQuote,
  render: (html: string) => Promise<{uri: string}> = (html) => Print.printToFileAsync({ html })): Promise<string> {
  const result = await render(buildVersionedQuoteHtml(q));
  if (!result.uri.startsWith('file://') || !/\.pdf(?:\?|$)/i.test(result.uri)) {
    removeQuotePdf(result.uri);
    throw new Error('Native renderer did not return a private PDF.');
  }
  return result.uri;
}
/** Native print UI provides PDF review; does not mark a quote as sent. */
export async function viewVersionedQuotePdf(uri: string): Promise<void> {
  await Print.printAsync({ uri });
}
/** Share sheet completion/cancellation NEVER confirms that the customer received it. */
export async function shareVersionedQuotePdf(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Device file sharing is unavailable.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share prepared quote' });
}
