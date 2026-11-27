// Independent dated state-only cases; asserts current defects in the pure engine used by UseTaxReportView.
import test from 'node:test';import assert from 'node:assert/strict';
import {reviewUseTax} from '../../src/lib/tax/usUseTax';
import {stateSalesTaxRate} from '../../src/lib/tax/usStateSalesTax';
import {productTreatment} from '../../src/lib/tax/usProductTaxability';

test('2025 Illinois grocery review applies the 2026 exemption retroactively',()=>{
 const out=reviewUseTax({state:'IL',from:'2025-11-01',to:'2025-11-30',homeCurrency:'USD',items:[{id:'groceries',productTaxCategory:'groceries'}],bills:[{id:'bill',date:'2025-11-01',status:'approved',currency:'USD',amountCents:100000,taxAmountCents:0,splits:[{itemId:'groceries',amountCents:100000}]}]});
 assert.deepEqual([productTreatment('IL','groceries')!.validFrom,out.totals.estimatedUseTaxCents,out.rows[0].exemptCents,out.rows[0].unclearCents],['2026-01-01',0,100000,0]);
 console.log(JSON.stringify({state:'IL',date:'2025-11-01',estimated:out.totals.estimatedUseTaxCents,exemptBase:out.rows[0].exemptCents,correctStateTax:1000}));
});

test('2023 South Dakota state-only use tax review applies 4.2% before the rate change',()=>{
 const out=reviewUseTax({state:'SD',from:'2023-06-01',to:'2023-06-30',homeCurrency:'USD',items:[{id:'general',productTaxCategory:'general'}],bills:[{id:'bill',date:'2023-06-01',status:'approved',currency:'USD',amountCents:100000,taxAmountCents:0,splits:[{itemId:'general',amountCents:100000}]}]});
 assert.deepEqual([stateSalesTaxRate('SD','2023-06-01'),out.totals.estimatedUseTaxCents,out.rows[0].unclearCents],[0.042,4200,0]);
 console.log(JSON.stringify({state:'SD',date:'2023-06-01',rate:stateSalesTaxRate('SD','2023-06-01'),estimated:out.totals.estimatedUseTaxCents,correctStateTax:4500}));
});
