import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { UnsentEstimateSection } from '../UnsentEstimateSection';
import { loadUnsentEstimate } from '../unsentEstimateApi';
import { generateVerifiedUnsentPdf } from '../verifiedUnsentPdf';
import { parseUnsentEstimate } from '../unsentEstimate';
jest.mock('expo-router',()=>({useFocusEffect:(cb:()=>()=>void)=>require('react').useEffect(cb,[cb])}));
jest.mock('expo-file-system',()=>({File: class File { delete() {} }}));
jest.mock('../unsentEstimateApi',()=>({loadUnsentEstimate:jest.fn()}));
jest.mock('../verifiedUnsentPdf',()=>({generateVerifiedUnsentPdf:jest.fn(),StaleEstimateError:class StaleEstimateError extends Error {}}));
const c={ project_id:'p',user_id:'a',project_title:'Kitchen',site_address:null,status:'draft',tax_bps:800,
  customer_name:'Alice',customer_phone:null,customer_email:null,business_name:'Builder',business_phone:null,business_address:null,
  tasks:[{id:'t',category:'Painting',title:'Painting',notes:'Visible task note',amount_minor:300000,sort_order:0}],
  charges:[{id:'c',description:'Permit',amount_minor:15000,sort_order:0}] };
const p=parseUnsentEstimate({content:c,fingerprint:'a'.repeat(64)},'a','p');
beforeEach(()=>{
  jest.mocked(loadUnsentEstimate).mockReset().mockResolvedValue(p);
  jest.mocked(generateVerifiedUnsentPdf).mockReset().mockResolvedValue('file:///cache/quote.pdf');
});
test('saved preview $3,402 and local unsent PDF never marks quote sent',async()=>{
  render(<UnsentEstimateSection accountId="a" accountScope={1} projectId="p" refreshKey={0}/>);
  fireEvent.press(screen.getByText('Preview estimate'));
  await waitFor(()=>expect(screen.getByText('$3,402.00')).toBeTruthy());
  expect(screen.getByText('Task notes: Visible task note')).toBeTruthy();
  fireEvent.press(screen.getByText('Generate unsent PDF'));
  await waitFor(()=>expect(generateVerifiedUnsentPdf).toHaveBeenCalledWith('a','p',p));
  expect(screen.getByText(/Unsent PDF generated in private app cache/)).toBeTruthy();
});
test('pricing revision invalidates previous preview with exact visible warning',async()=>{
  const view=render(<UnsentEstimateSection accountId="a" accountScope={1} projectId="p" refreshKey={0}/>);
  fireEvent.press(screen.getByText('Preview estimate'));
  await waitFor(()=>expect(screen.getByText('$3,402.00')).toBeTruthy());
  view.rerender(<UnsentEstimateSection accountId="a" accountScope={1} projectId="p" refreshKey={1}/>);
  await waitFor(()=>expect(screen.getByText('Estimate changed — preview again.')).toBeTruthy());
  expect(screen.queryByText('$3,402.00')).toBeNull();
});
test('pricing save during in-flight preview cancels stale response and unlocks preview button',async()=>{
  let complete!: (snapshot: typeof p) => void;
  jest.mocked(loadUnsentEstimate).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const view=render(<UnsentEstimateSection accountId="a" accountScope={1} projectId="p" refreshKey={0}/>);
  fireEvent.press(screen.getByText('Preview estimate'));
  await waitFor(()=>expect(screen.getByText('Loading estimate…')).toBeTruthy());
  view.rerender(<UnsentEstimateSection accountId="a" accountScope={1} projectId="p" refreshKey={1}/>);
  complete(p);
  await waitFor(()=>expect(screen.getByText('Estimate changed — preview again.')).toBeTruthy());
  await waitFor(()=>expect(screen.getByText('Preview estimate')).toBeTruthy());
  expect(screen.queryByText('$3,402.00')).toBeNull();
});
