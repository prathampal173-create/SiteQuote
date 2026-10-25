import { confirmQuoteSent, listPreparedQuotes, prepareQuote } from '../preparedQuotesApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
jest.mock('../../../lib/supabase',()=>({ getSupabaseClient:jest.fn(),isCurrentSupabaseClient:jest.fn() }));
jest.mock('../../auth/sessionValidation',()=>({ validateServerSession:jest.fn() }));
const A='owner'; const P='project';
const content={project_id:P,user_id:A,project_title:'P',site_address:null,status:'draft',tax_bps:0,
  customer_name:'Customer',customer_phone:null,customer_email:null,business_name:'Business',business_phone:null,business_address:null,
  tasks:[{id:'t',category:'Painting',title:'T',notes:null,amount_minor:100,sort_order:0}],charges:[]};
const totals={taskSubtotalMinor:100,chargesTotalMinor:0,pretaxMinor:100,taxMinor:0,finalMinor:100,taxBps:0};
const quote={id:'q',user_id:A,project_id:P,version:1,status:'prepared',fingerprint:'a'.repeat(64),request_key:'k',
  snapshot:{content,totals},tasks_subtotal_minor:100,charges_total_minor:0,tax_bps:0,tax_minor:0,total_minor:100,
  issued_at:'2026-10-23T00:00:00Z',sent_at:null};
const rpc=jest.fn(); const range=jest.fn();
const client={rpc,from:jest.fn(()=>({ select:()=>({ eq:()=>({ eq:()=>({ order:()=>({range}) }) }) }) }))};
beforeEach(()=>{
  rpc.mockReset();range.mockReset();client.from.mockClear();
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({userId:A,accessToken:'token',expiresAtMs:Date.now()+60000});
  rpc.mockResolvedValue({data:{result:'created',quote},error:null});range.mockResolvedValue({data:[quote],error:null});
});
test('prepares with unaltered fingerprint and stable request key', async()=>{
  expect((await prepareQuote(A,P,'a'.repeat(64),'key')).result).toBe('created');
  expect(rpc).toHaveBeenCalledWith('prepare_quote', {p_project_id:P,p_preview_fingerprint:'a'.repeat(64),p_request_key:'key'});
});
test('stale fingerprint returns explicit preview-again error',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'Estimate changed — preview again.'}});
  await expect(prepareQuote(A,P,'a'.repeat(64),'key')).rejects.toThrow('Estimate changed');
});
test('account mismatch blocks RPC and late account switch discards quote',async()=>{
  await expect(prepareQuote('other',P,'a'.repeat(64),'key')).rejects.toThrow('session');
  expect(rpc).not.toHaveBeenCalled();
  jest.mocked(isCurrentSupabaseClient).mockReturnValueOnce(true).mockReturnValueOnce(false);
  await expect(prepareQuote(A,P,'a'.repeat(64),'key')).rejects.toThrow('account changed');
});
test('version list is owner and project filtered and parsed', async()=>{
  expect((await listPreparedQuotes(A,P))[0]?.version).toBe(1);
  expect(client.from).toHaveBeenCalledWith('quotes');
  range.mockResolvedValue({data:[{...quote,user_id:'other'}],error:null});
  await expect(listPreparedQuotes(A,P)).rejects.toThrow('unauthorized');
});

test('explicit Sent confirmation parses the returned immutable version and rechecks account',async()=>{
  rpc.mockResolvedValue({data:{...quote,status:'sent',sent_at:'2026-10-23T00:01:00Z'},error:null});
  const sent=await confirmQuoteSent(A,P,'q');
  expect(sent.status).toBe('sent');
  expect(rpc).toHaveBeenCalledWith('confirm_quote_sent',{p_quote_id:'q'});
});
test('Sent confirmation rejects foreign quote, absent evidence and account switch',async()=>{
  rpc.mockResolvedValue({data:{...quote,status:'sent',user_id:'foreign'},error:null});
  await expect(confirmQuoteSent(A,P,'q')).rejects.toThrow('unauthorized');
  rpc.mockResolvedValue({data:{...quote,status:'sent'},error:null});
  jest.mocked(isCurrentSupabaseClient).mockReturnValueOnce(true).mockReturnValueOnce(false);
  await expect(confirmQuoteSent(A,P,'q')).rejects.toThrow('account changed');
});
