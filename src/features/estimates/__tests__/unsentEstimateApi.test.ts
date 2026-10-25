import { loadUnsentEstimate } from '../unsentEstimateApi';
import { getSupabaseClient, isCurrentSupabaseClient } from '../../../lib/supabase';
import { validateServerSession } from '../../auth/sessionValidation';
jest.mock('../../../lib/supabase',()=>({getSupabaseClient:jest.fn(),isCurrentSupabaseClient:jest.fn()}));
jest.mock('../../auth/sessionValidation',()=>({validateServerSession:jest.fn()}));
const client = {rpc:jest.fn()};
const content={project_id:'p',user_id:'a',project_title:'P',site_address:null,status:'draft',tax_bps:0,
  customer_name:'A',customer_phone:null,customer_email:null,business_name:null,business_phone:null,business_address:null,
  tasks:[],charges:[]};
beforeEach(()=>{
  client.rpc.mockReset();
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  jest.mocked(isCurrentSupabaseClient).mockReturnValue(true);
  jest.mocked(validateServerSession).mockResolvedValue({userId:'a',accessToken:'token',expiresAtMs:Date.now()+60000});
  client.rpc.mockResolvedValue({data:{fingerprint:'a'.repeat(64),content},error:null});
});
test('one owner-scoped RPC returns consistent snapshot',async()=>{
  const result=await loadUnsentEstimate('a','p');
  expect(result.totals.finalMinor).toBe(0);
  expect(client.rpc).toHaveBeenCalledTimes(1);
  expect(client.rpc).toHaveBeenCalledWith('get_unsent_estimate_snapshot',{p_project_id:'p'});
});
test('account B is refused before querying account A',async()=>{
  await expect(loadUnsentEstimate('b','p')).rejects.toThrow('session');
  expect(client.rpc).not.toHaveBeenCalled();
});
test('RLS empty response fails closed, never shows other project',async()=>{
  client.rpc.mockResolvedValue({data:null,error:null});
  await expect(loadUnsentEstimate('a','p')).rejects.toThrow('access is denied');
});
test('switching account after RPC rejects late result',async()=>{
  jest.mocked(isCurrentSupabaseClient).mockReturnValueOnce(true).mockReturnValueOnce(false);
  await expect(loadUnsentEstimate('a','p')).rejects.toThrow('account changed');
});
