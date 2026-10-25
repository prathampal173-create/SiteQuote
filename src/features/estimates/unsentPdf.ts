import { formatUsdCents } from '../tasks/taskModel';
import { formatTaxBps } from './estimateMath';
import type { UnsentEstimate } from './unsentEstimate';
export type PdfIdentity = { reference: string; issueDate: string };

/** Encodes all persisted/user-supplied strings before passing HTML to the native renderer. */
export function escapePdfHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function safe(value: string | null): string { return escapePdfHtml(value || '—'); }
function money(value: number): string { return escapePdfHtml(formatUsdCents(value)); }
/** Render ONLY the whitelisted snapshot content; never expose customer/project internal notes or photos. */
export function buildUnsentEstimateHtml(snapshot: UnsentEstimate, identity?: PdfIdentity): string {
  const { content: c, totals: t } = snapshot;
  const taskRows = c.tasks.map((task, index) => `<tr><td class="count">${index + 1}</td><td>
    <b>${safe(task.title)}</b><div class="category">${safe(task.category)}</div>
    ${task.notes?.trim() ? `<div class="note">${safe(task.notes)}</div>` : ''}
    </td><td class="money">${money(task.amount_minor)}</td></tr>`).join('');
  const chargeRows = c.charges.map((charge) => `<tr><td colspan="2">${safe(charge.description)}</td>
    <td class="money">${money(charge.amount_minor)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @page{size:letter;margin:42px}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;color:#233346;font-size:11px;line-height:1.5}
    .head{border-bottom:3px solid #194c73;padding-bottom:17px;margin-bottom:21px}.eyebrow{text-transform:uppercase;letter-spacing:2px;color:#51738c;font-size:10px;font-weight:700}
    h1{font-size:27px;letter-spacing:-.7px;margin:5px 0 4px}h2{font-size:14px;color:#194c73;margin:24px 0 9px}.draft{font-size:12px;color:#7b4b05;font-weight:700}
    .details{display:table;width:100%;margin-bottom:20px}.detail{display:table-cell;vertical-align:top;width:50%;padding-right:25px;overflow-wrap:anywhere}
    .label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#627488;font-weight:700;margin-bottom:5px}.name{font-size:15px;font-weight:700}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#eaf0f5;color:#34485d;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:left}
    th,td{padding:10px 8px;border-bottom:1px solid #e1e8ee;vertical-align:top;overflow-wrap:anywhere}tr{break-inside:avoid;page-break-inside:avoid}.count{width:8%;color:#687b8b}.money{width:23%;text-align:right;white-space:nowrap}
    .category{font-size:10px;color:#627488}.note{font-size:10px;color:#4d6173;white-space:pre-wrap;margin-top:4px}
    .totals{margin:23px 0 0 auto;width:55%;border-top:2px solid #d9e4ec}.totals .line{display:table;width:100%;padding:6px 8px}
    .totals .line span{display:table-cell}.totals .line span:last-child{text-align:right}.grand{background:#194c73;color:#fff;font-weight:700;font-size:16px}
    footer{margin-top:30px;border-top:1px solid #dae4eb;padding-top:12px;color:#607489;font-size:10px}
  </style></head><body><header class="head"><div class="eyebrow">SiteQuote · Project estimate</div>
    <h1>${identity ? `Quote ${safe(identity.reference)}` : 'Unsent estimate'}</h1><div class="draft">${identity ? `Prepared version · Issued ${safe(identity.issueDate)} · ${safe(identity.reference)}` : 'UNSENT · Not a prepared or sent quote'}</div></header>
    <section class="details"><div class="detail"><div class="label">From</div><div class="name">${safe(c.business_name)}</div>
      <div>${safe(c.business_address)}</div><div>${safe(c.business_phone)}</div></div>
      <div class="detail"><div class="label">Prepared for</div><div class="name">${safe(c.customer_name)}</div>
      <div>${safe(c.customer_phone)}</div><div>${safe(c.customer_email)}</div></div></section>
    <section><div class="label">Project</div><div class="name">${safe(c.project_title)}</div><div>${safe(c.site_address)}</div></section>
    <h2>Itemized task costs</h2><table><thead><tr><th class="count">#</th><th>Task &amp; permitted notes</th><th class="money">USD</th></tr></thead>
      <tbody>${taskRows || '<tr><td colspan="3">No saved tasks</td></tr>'}</tbody></table>
    <h2>Additional charges</h2><table><thead><tr><th colspan="2">Description</th><th class="money">USD</th></tr></thead>
      <tbody>${chargeRows || '<tr><td colspan="3">No additional charges</td></tr>'}</tbody></table>
    <div class="totals">
      <div class="line"><span>Task subtotal</span><span>${money(t.taskSubtotalMinor)}</span></div>
      <div class="line"><span>Additional charges</span><span>${money(t.chargesTotalMinor)}</span></div>
      <div class="line"><span>Pretax subtotal</span><span>${money(t.pretaxMinor)}</span></div>
      <div class="line"><span>Tax (${formatTaxBps(t.taxBps)}%)</span><span>${money(t.taxMinor)}</span></div>
      <div class="line grand"><span>Final estimate</span><span>${money(t.finalMinor)}</span></div></div>
    <footer>USD amounts · ${identity ? `Immutable quote version ${safe(identity.reference)} · Sharing alone does not confirm sending.` : 'This unsent preview is for review only. No quote has been prepared or delivered.'}</footer>
  </body></html>`;
}
