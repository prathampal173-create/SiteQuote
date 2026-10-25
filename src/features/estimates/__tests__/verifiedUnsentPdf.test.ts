import { generateVerifiedUnsentPdf, StaleEstimateError } from '../verifiedUnsentPdf';
import { parseUnsentEstimate } from '../unsentEstimate';
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
const content = { project_id:'p',user_id:'a',project_title:'P',site_address:null,status:'draft',tax_bps:800,
  customer_name:'A',customer_phone:null,customer_email:null,business_name:null,business_phone:null,business_address:null,
  tasks:[{id:'t',category:'Painting',title:'T',notes:null,amount_minor:300000,sort_order:0}],
  charges:[{id:'c',description:'Extra',amount_minor:15000,sort_order:0}] };
const a = parseUnsentEstimate({ content, fingerprint:'a'.repeat(64) },'a','p');
const b = parseUnsentEstimate({ content:{...content, tax_bps:900}, fingerprint:'b'.repeat(64) },'a','p');
test('two fresh server comparisons agree before releasing PDF, acceptance value present', async () => {
  const render = jest.fn(async (html:string) => {
    expect(html).toContain('$3,402.00');
    return {uri:'file:///cache/unsent.pdf'};
  });
  const load = jest.fn(async () => a);
  await expect(generateVerifiedUnsentPdf('a','p',a,{load,render})).resolves.toBe('file:///cache/unsent.pdf');
  expect(load).toHaveBeenCalledTimes(2);
  expect(render).toHaveBeenCalledTimes(1);
});
test('stale before rendering rejects without producing PDF', async () => {
  const render=jest.fn();
  await expect(generateVerifiedUnsentPdf('a','p',a,{load:async()=>b,render})).rejects.toBeInstanceOf(StaleEstimateError);
  expect(render).not.toHaveBeenCalled();
});
test('edit during rendering rejects and deletes private cached PDF', async () => {
  let n=0; const remove=jest.fn();
  await expect(generateVerifiedUnsentPdf('a','p',a,{load:async()=>++n===1?a:b,
    render:async()=>({uri:'file:///cache/unsent.pdf'}),remove})).rejects.toBeInstanceOf(StaleEstimateError);
  expect(remove).toHaveBeenCalledWith('file:///cache/unsent.pdf');
});
test('after-render network failure cleans cache, never exposes file', async () => {
  let n=0;const remove=jest.fn();
  await expect(generateVerifiedUnsentPdf('a','p',a,{load:async()=>{if(++n===2)throw Error('offline');return a;},
    render:async()=>({uri:'file:///cache/unsent.pdf'}),remove})).rejects.toThrow('offline');
  expect(remove).toHaveBeenCalledTimes(1);
});
