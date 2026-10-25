import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { renderVersionedQuotePdf, shareVersionedQuotePdf, viewVersionedQuotePdf } from '../versionedPdf';
jest.mock('expo-print', () => ({ printToFileAsync:jest.fn(),printAsync:jest.fn() }));
jest.mock('expo-sharing', () => ({isAvailableAsync:jest.fn(),shareAsync:jest.fn()}));
jest.mock('expo-file-system', () => ({ File:jest.fn() }));
const q={id:'q',user_id:'A',project_id:'c5555555-5555-4555-8555-555555555555',version:1,status:'prepared',
 fingerprint:'a'.repeat(64),request_key:'r',issued_at:'2026-10-23T00:00:00Z',sent_at:null,
 snapshot:{content:{project_id:'c5555555-5555-4555-8555-555555555555',user_id:'A',project_title:'Project',site_address:null,status:'draft',tax_bps:800,
 customer_name:'A',customer_phone:null,customer_email:null,business_name:'Builder',business_phone:null,business_address:null,
 tasks:[{id:'t',category:'Painting',title:'Paint',notes:null,amount_minor:300000,sort_order:0}],
 charges:[{id:'c',description:'Fee',amount_minor:15000,sort_order:0}]},
 totals:{taskSubtotalMinor:300000,chargesTotalMinor:15000,pretaxMinor:315000,taxMinor:25200,finalMinor:340200,taxBps:800}},
 tasks_subtotal_minor:300000,charges_total_minor:15000,tax_bps:800,tax_minor:25200,total_minor:340200} as never;
test('renders versioned acceptance PDF from saved snapshot, no network call',async()=>{
 const render=jest.fn().mockResolvedValue({uri:'file:///cache/v1.pdf'});
 expect(await renderVersionedQuotePdf(q,render)).toBe('file:///cache/v1.pdf');
 expect(render.mock.calls[0][0]).toContain('$3,402.00');
 expect(render.mock.calls[0][0]).toContain('SQ-C55555555555-v1');
});
test('share sheet return or cancel never updates quote status',async()=>{
 jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
 jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
 await shareVersionedQuotePdf('file:///cache/v1.pdf');
 expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
 expect(jest.mocked(Print.printAsync)).not.toHaveBeenCalled();
 jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
 await expect(shareVersionedQuotePdf('file:///cache/v1.pdf')).rejects.toThrow('unavailable');
});
test('native preview uses cached file, never confirms Sent',async()=>{
 jest.mocked(Print.printAsync).mockResolvedValue(undefined);
 await viewVersionedQuotePdf('file:///cache/v1.pdf');
 expect(Print.printAsync).toHaveBeenCalledWith({uri:'file:///cache/v1.pdf'});
});
