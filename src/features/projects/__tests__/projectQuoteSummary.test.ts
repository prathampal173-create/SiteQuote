import { quoteSummaryLine, summarizeQuote } from '../projectQuoteSummary';
import type { Project } from '../projectModel';
const p: Project = { id:'p', user_id:'A', lead_id:'lead', title:'Kitchen', site_address:null, notes:null,
  status:'quote_sent', accepted_quote_id:null, tax_bps:800, created_at:'2026', updated_at:'2026' };
const sent = [
  {id:'v1',project_id:'p',user_id:'A',status:'sent',version:1,total_minor:340200},
  {id:'v2',project_id:'p',user_id:'A',status:'sent',version:2,total_minor:400000},
  {id:'prepared',project_id:'p',user_id:'A',status:'prepared',version:3,total_minor:600000},
  {id:'foreign',project_id:'p',user_id:'B',status:'sent',version:4,total_minor:800000}
];
test('highest numbered Sent wins for open/Lost and Prepared/foreign rows never count', () => {
  expect(quoteSummaryLine(p,summarizeQuote(p,sent))).toContain('$4,000.00');
  expect(quoteSummaryLine({...p,status:'lost'},summarizeQuote({...p,status:'lost'},sent))).toContain('SQ-');
  expect(quoteSummaryLine(p,summarizeQuote(p,[]))).toBe('No sent quote');
});
test('Won shows selected older Sent quote, not latest Sent', () => {
  const won={...p,status:'won' as const,accepted_quote_id:'v1'};
  expect(quoteSummaryLine(won,summarizeQuote(won,sent))).toContain('Accepted quote: $3,402.00');
  expect(quoteSummaryLine({...won,accepted_quote_id:'foreign'},summarizeQuote({...won,accepted_quote_id:'foreign'},sent)))
    .toContain('unavailable');
});
