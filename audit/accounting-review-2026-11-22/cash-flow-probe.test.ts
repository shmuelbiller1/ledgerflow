// Independent synthetic cash-flow counterexample; asserts current incorrect section amounts.
import test from 'node:test';import assert from 'node:assert/strict';import {computeCashFlow} from '../../src/server/reports/computeReports';
test('partly financed equipment purchase contains fictional gross cash flows',()=>{
 const accounts=[{id:'cash',name:'Bank',type:'asset',category:'Cash',code:'1000'},{id:'equip',name:'Equipment',type:'asset',category:'Fixed Assets',code:'1500'},{id:'loan',name:'Loan Payable',type:'liability',category:'Long Term Liabilities',code:'2500'}];
 const tx={id:'t',date:'2026-05-01',description:'Equipment paid partly with cash and supplier loan',status:'completed',type:'actual',currency:'USD',exchangeRate:1,lines:[{accountId:'equip',amountCents:1_000_000},{accountId:'cash',amountCents:-200_000},{accountId:'loan',amountCents:-800_000}]};
 const result=computeCashFlow(accounts as never,[tx] as never,'2026-05-01','2026-05-31');
 assert.deepEqual([result.investing.total,result.financing.total,result.netChange],[-1_000_000,800_000,-200_000]);
 console.log(JSON.stringify(result));
});
