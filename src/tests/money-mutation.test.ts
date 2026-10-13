/** Hand-number contracts for the four D-11 files; no statutory tax tables or posting changes. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDocumentNet,
  calculateDocumentTax,
  calculateAmountDue,
  depositAppliedCents,
  cashPostedWithDocumentCents,
  normalizeTaxRate,
  netFromGross,
  settledStatus,
} from "../lib/documentMath";
import { moneyText, MONEY_LOCALES } from "../lib/moneyFormat";
import {
  creditTaxFrom,
  TAX_TREATMENTS,
  computeTax,
  computeTaxReturn,
  taxCodeFromRate,
  customRateCode,
} from "../lib/taxCodes";
test("tax rates and independently numbered exclusive/inclusive documents", () => {
  assert.equal(normalizeTaxRate(20), 0.2);
  assert.equal(normalizeTaxRate(0.2), 0.2);
  for (const rate of [undefined, 0, -1, NaN])
    assert.equal(normalizeTaxRate(rate), 0);
  assert.equal(
    calculateDocumentTax({
      amountCents: 10000,
      discountCents: 1000,
      taxRate: 20,
    }),
    1800,
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 12000,
      taxInclusive: true,
      taxRate: 20,
    }),
    2000,
  );
  assert.equal(
    calculateDocumentNet({
      amountCents: 12000,
      taxInclusive: true,
      taxRate: 20,
    }),
    10000,
  );
  assert.equal(netFromGross(1000, 0.2), 833);
  assert.equal(
    calculateDocumentNet({
      amountCents: 10800,
      taxAmountCents: 1800,
      discountCents: 1000,
      taxVersion: 2,
    }),
    9000,
  );
});

test("explicit tax precedence, rounding and zero overrides are preserved", () => {
  assert.equal(
    calculateDocumentTax({
      amountCents: 10000,
      taxRate: 20,
      taxAmountCents: 100.5,
      taxCents: 200,
      salesTaxCents: 300,
    }),
    101,
  );
  assert.equal(calculateDocumentTax({ taxAmountCents: 0, taxCents: 200 }), 0);
  assert.equal(
    calculateDocumentTax({ taxAmountCents: NaN, taxCents: 200.5 }),
    201,
  );
  assert.equal(calculateDocumentTax({ salesTaxCents: 300.5 }), 301);
  assert.equal(calculateDocumentTax({ taxAmountCents: -1 }), 0);
});

test("deposit and record-settled cash never reduce the taxable base or double-post payments", () => {
  const doc = { amountCents: 10000, depositCents: 2500, amountPaidCents: 3000 };
  assert.equal(depositAppliedCents(doc), 2500);
  assert.equal(calculateAmountDue(doc), 4500);
  assert.equal(
    depositAppliedCents({ amountCents: 1000, depositCents: 2000 }),
    1000,
  );
  assert.equal(
    calculateAmountDue({ amountCents: 1000, amountPaidCents: 2000 }),
    0,
  );
  assert.equal(settledStatus({ amountCents: 1000 }, 999), "partially_paid");
  assert.equal(settledStatus({ amountCents: 1000 }, 1000), "paid");
  assert.equal(
    cashPostedWithDocumentCents({
      ...doc,
      status: "paid",
      settledByRecordsCents: 1000,
    }),
    2000,
  );
  assert.equal(
    cashPostedWithDocumentCents({
      amountCents: 10000,
      depositCents: 2500,
      status: "paid",
    }),
    7500,
  );
  assert.equal(cashPostedWithDocumentCents({ ...doc, status: "draft" }), 0);
});

test("money display uses the supplied minor-unit precision and original sign", () => {
  assert.equal(moneyText(12345, "USD", 2, { locale: "en-US" }), "$123.45");
  assert.equal(moneyText(-12345, "USD", 2, { locale: "en-US" }), "-$123.45");
  assert.equal(
    moneyText(-12345, "USD", 2, {
      locale: "en-US",
      negativeStyle: "accounting",
    }),
    "($123.45)",
  );
  assert.equal(moneyText(12345, "JPY", 0, { locale: "en-US" }), "¥12,345");
  assert.equal(moneyText(12345, "USD", 3, { locale: "en-US" }), "$12.345");
  assert.equal(moneyText(NaN, "USD", 2, { locale: "en-US" }), "$0.00");
  assert.equal(
    moneyText(-12345, "INVALID_CURRENCY", 2, { negativeStyle: "accounting" }),
    "(INVALID_CURRENCY 123.45)",
  );
});

test("missing, invalid and negative explicit tax fields fall through or clamp at their own boundary", () => {
  const nullable = JSON.parse(
    '{"taxAmountCents":null,"taxCents":null,"salesTaxCents":25.5}',
  ) as Parameters<typeof calculateDocumentTax>[0];
  assert.equal(calculateDocumentTax(nullable), 26);
  assert.equal(
    calculateDocumentTax({
      taxAmountCents: NaN,
      taxCents: NaN,
      salesTaxCents: 40,
    }),
    40,
  );
  assert.equal(
    calculateDocumentTax(
      JSON.parse(
        '{"amountCents":10000,"taxRate":20,"salesTaxCents":null}',
      ) as Parameters<typeof calculateDocumentTax>[0],
    ),
    2000,
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 10000,
      taxRate: 20,
      salesTaxCents: NaN,
    }),
    2000,
  );
  assert.equal(calculateDocumentTax({ taxCents: -12 }), 0);
  assert.equal(calculateDocumentTax({ salesTaxCents: -12 }), 0);
  assert.equal(
    normalizeTaxRate(1),
    1,
    "one is the fraction boundary, above one is percent",
  );
  assert.equal(
    calculateDocumentTax({ amountCents: 150, taxRate: 0.01 }),
    2,
    "1.5 cents rounds once to 2",
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 12000,
      discountCents: 1200,
      taxRate: 20,
      taxInclusive: true,
    }),
    1800,
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 1000,
      discountCents: 2000,
      taxRate: 20,
      taxInclusive: true,
    }),
    0,
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 1000,
      discountCents: 2000,
      taxRate: 20,
    }),
    0,
  );
  assert.equal(
    calculateDocumentTax({
      amountCents: 10000,
      discountCents: -1000,
      taxRate: 20,
    }),
    2000,
  );
  assert.equal(calculateDocumentNet({}), 0);
  assert.equal(
    calculateDocumentNet({
      amountCents: 100,
      taxAmountCents: 150,
      taxInclusive: true,
    }),
    0,
  );
  assert.equal(
    calculateDocumentNet({
      amountCents: 100,
      taxAmountCents: 150,
      taxVersion: 2,
    }),
    0,
  );
  assert.equal(
    calculateDocumentNet({
      amountCents: 10800,
      discountCents: 1000,
      taxAmountCents: 1800,
      taxVersion: 1,
    }),
    9800,
  );
});

test("settlement boundaries, fractional deposits and record-only payments remain distinct", () => {
  assert.equal(
    depositAppliedCents({ amountCents: 10000, depositCents: 2500.5 }),
    2501,
  );
  assert.equal(depositAppliedCents({ amountCents: -1, depositCents: 100 }), 0);
  assert.equal(depositAppliedCents({ amountCents: 100, depositCents: -1 }), 0);
  assert.equal(depositAppliedCents({}), 0);
  assert.equal(
    calculateAmountDue({
      amountCents: 1000,
      amountPaidCents: -100,
      depositCents: -100,
    }),
    1000,
  );
  assert.equal(
    settledStatus({ amountCents: 1000, depositCents: 1000 }, 0),
    "paid",
  );
  assert.equal(
    cashPostedWithDocumentCents({
      amountCents: 1000,
      status: "partially_paid",
    }),
    0,
  );
  assert.equal(
    cashPostedWithDocumentCents({
      amountCents: 1000,
      status: "partially_paid",
      amountPaidCents: 400,
      settledByRecordsCents: 500,
    }),
    0,
  );
  assert.equal(
    cashPostedWithDocumentCents({
      amountCents: 1000,
      status: "partially_paid",
      amountPaidCents: 400,
      settledByRecordsCents: -50,
    }),
    400,
  );
});

test("a partial credit returns only its proportional tax and retains the reporting treatment", () => {
  const document = { amountCents: 12000, taxAmountCents: 2000, taxVersion: 2 };
  assert.deepEqual(creditTaxFrom(6000, document), {
    taxAmountCents: 1000,
    taxInclusive: true,
    taxVersion: 2,
    taxTreatment: "standard",
  });
  assert.equal(creditTaxFrom(-6000, document).taxAmountCents, 0);
  assert.equal(
    creditTaxFrom(1000, { amountCents: 0, taxAmountCents: 0 }).taxAmountCents,
    0,
  );
  assert.equal(
    creditTaxFrom(1000, {
      amountCents: 1000,
      taxAmountCents: 0,
      taxTreatment: "zero_rated",
    }).taxTreatment,
    "zero_rated",
  );
  assert.equal(
    creditTaxFrom(1000, { amountCents: 1000, taxAmountCents: 0 }).taxTreatment,
    undefined,
  );
});

test("display controls offer unique valid locales, readable labels and all reporting treatments", () => {
  assert.ok(
    MONEY_LOCALES.length >= 10,
    "keep the offered international formats",
  );
  assert.equal(MONEY_LOCALES[0].value, "", "browser default comes first");
  assert.equal(
    new Set(MONEY_LOCALES.map((choice) => choice.value)).size,
    MONEY_LOCALES.length,
  );
  MONEY_LOCALES.forEach((choice, index) => {
    assert.ok(choice.label.trim());
    if (index > 0)
      assert.equal(Intl.getCanonicalLocales(choice.value).length, 1);
  });
  assert.deepEqual(Object.keys(TAX_TREATMENTS).sort(), [
    "exempt",
    "out_of_scope",
    "reverse_charge",
    "standard",
    "zero_rated",
  ]);
  assert.ok(
    Object.values(TAX_TREATMENTS).every((label) => label.trim().length > 0),
  );
});

test("accounting applies only to negative amounts and locale input bounds preserve the fallback", () => {
  assert.equal(
    moneyText(12345, "USD", 2, {
      locale: "en-US",
      negativeStyle: "accounting",
    }),
    "$123.45",
  );
  for (const value of [null, undefined, Infinity, -Infinity, NaN, 0])
    assert.equal(
      moneyText(value, "USD", 2, {
        locale: "en-US",
        negativeStyle: "accounting",
      }),
      "$0.00",
    );
  assert.equal(
    moneyText(-12345, "INVALID_CURRENCY", 2),
    "INVALID_CURRENCY -123.45",
  );
  const browserDefault = moneyText(12345, "USD", 2);
  assert.equal(
    moneyText(12345, "USD", 2, { locale: "not_a_locale" }),
    browserDefault,
  );
  const privateUseLocale = "de-DE-x" + "-abcdefgh".repeat(6) + "-xy";
  assert.equal(privateUseLocale.length, 64);
  assert.equal(
    moneyText(12345, "USD", 2, { locale: privateUseLocale }),
    "123,45\u00a0$",
  );
  assert.equal(
    moneyText(12345, "USD", 2, { locale: privateUseLocale + "z" }),
    browserDefault,
  );
});

test("tax breakdown filters invalid parts, preserves reverse-charge metadata, and reports untaxed treatments", () => {
  const code = {
    id: "parts",
    name: "Parts",
    treatment: "standard" as const,
    components: [
      { name: "Zero", rate: 0 },
      { name: "Negative", rate: -2 },
      { name: "Invalid", rate: NaN },
      { name: "Infinite", rate: Infinity },
      { name: "Valid", rate: 20 },
    ],
  };
  assert.deepEqual(computeTax(1000, code), {
    treatment: "standard",
    netCents: 1000,
    taxCents: 200,
    components: [{ name: "Valid", rate: 20, taxCents: 200 }],
    selfAssessedCents: 0,
  });
  assert.deepEqual(computeTax(1000, { ...code, treatment: "reverse_charge" }), {
    treatment: "reverse_charge",
    netCents: 1000,
    taxCents: 0,
    components: [{ name: "Valid", rate: 20, taxCents: 200 }],
    selfAssessedCents: 200,
  });
  for (const treatment of ["zero_rated", "exempt", "out_of_scope"] as const)
    assert.deepEqual(computeTax(1000, { ...code, treatment }), {
      treatment,
      netCents: 1000,
      taxCents: 0,
      components: [],
      selfAssessedCents: 0,
    });
  assert.deepEqual(computeTax(1000, undefined), {
    treatment: "out_of_scope",
    netCents: 1000,
    taxCents: 0,
    components: [],
    selfAssessedCents: 0,
  });
  assert.deepEqual(computeTax(1000, { ...code, components: [] }), {
    treatment: "standard",
    netCents: 1000,
    taxCents: 0,
    components: [],
    selfAssessedCents: 0,
  });
});

test("saved and custom rate adapters retain identities, parts and the legacy fraction boundary", () => {
  assert.deepEqual(taxCodeFromRate({ id: "vat", name: "VAT", rate: 0.2 }), {
    id: "vat",
    name: "VAT",
    treatment: "standard",
    components: [{ name: "VAT", rate: 20 }],
  });
  assert.deepEqual(taxCodeFromRate({ id: "vat", name: "VAT", rate: 20 }), {
    id: "vat",
    name: "VAT",
    treatment: "standard",
    components: [{ name: "VAT", rate: 20 }],
  });
  assert.deepEqual(
    taxCodeFromRate({
      id: "compound",
      name: "Two parts",
      rate: 90,
      treatment: "reverse_charge",
      components: [
        { name: "First", rate: 5 },
        { name: "Second", rate: 10, compound: true },
      ],
    }),
    {
      id: "compound",
      name: "Two parts",
      treatment: "reverse_charge",
      components: [
        { name: "First", rate: 5 },
        { name: "Second", rate: 10, compound: true },
      ],
    },
  );
  assert.equal(
    taxCodeFromRate({ id: "unit", name: "Fraction boundary", rate: 1 })
      .components[0].rate,
    100,
  );
  assert.equal(
    taxCodeFromRate({
      id: "invalid",
      name: "Unconverted negative rate",
      rate: -5,
    }).components[0].rate,
    -5,
  );
  for (const rate of [0, -1, NaN]) assert.equal(customRateCode(rate), null);
  assert.deepEqual(customRateCode(20), {
    id: "custom",
    name: "Tax 20%",
    treatment: "standard",
    components: [{ name: "Tax", rate: 20 }],
  });
  assert.equal(customRateCode(0.2)?.components[0].rate, 20);
  assert.equal(customRateCode(1)?.components[0].rate, 100);
});

test("every posted document state is counted, while drafts and sales-only states on purchases are refused", () => {
  const period = { startDate: "2024-02-01", endDate: "2024-02-29" };
  const row = {
    id: "document",
    date: "2024-02-29",
    netCents: 1000,
    taxCents: 200,
  };
  for (const status of [
    "sent",
    "pending",
    "approved",
    "paid",
    "partially_paid",
    "overdue",
    "issued",
    "applied",
    "partially_applied",
    "open",
  ]) {
    const report = computeTaxReturn({
      ...period,
      sales: [{ ...row, status }],
      purchases: [],
    });
    assert.equal(report.documentCount, 1, status);
    assert.deepEqual(
      report.boxes.map((box) => box.cents),
      [200, 0, 200, 0, 200, 1000, 0, 0, 0],
    );
    assert.ok(report.boxes.every((box) => box.label.trim()));
    assert.deepEqual(
      report.boxes.map((box) => box.key),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    );
  }
  for (const status of [
    "pending",
    "approved",
    "paid",
    "partially_paid",
    "overdue",
    "unpaid",
    "issued",
    "applied",
    "partially_applied",
    "open",
  ]) {
    const report = computeTaxReturn({
      ...period,
      sales: [],
      purchases: [{ ...row, status }],
    });
    assert.equal(report.documentCount, 1, status);
    assert.deepEqual(
      report.boxes.map((box) => box.cents),
      [0, 0, 0, 200, -200, 0, 1000, 0, 0],
    );
  }
  assert.equal(
    computeTaxReturn({
      ...period,
      sales: [{ ...row, status: "draft" }],
      purchases: [{ ...row, status: "sent" }],
    }).documentCount,
    0,
  );
});

test("period edges, FX fallback, purchase credits and untaxed sales keep independently worked boxes", () => {
  const period = { startDate: "2024-02-01", endDate: "2024-02-29" };
  const row = {
    id: "base",
    date: "2024-02-01",
    status: "paid",
    netCents: 1000,
    taxCents: 200,
  };
  const report = computeTaxReturn({
    ...period,
    sales: [
      row,
      {
        ...row,
        id: "end",
        date: undefined,
        issueDate: "2024-02-29T12:00:00Z",
        exchangeRate: 0,
      },
      { ...row, id: "before", date: "2024-01-31" },
      { ...row, id: "after", date: "2024-03-01" },
      { ...row, id: "none", date: undefined, issueDate: undefined },
      { ...row, id: "zero", taxCents: 0, taxTreatment: "zero_rated" },
      { ...row, id: "exempt", taxCents: 0, taxTreatment: "exempt" },
      { ...row, id: "out", taxCents: 0 },
    ],
    purchases: [
      {
        ...row,
        id: "reverse",
        taxTreatment: "reverse_charge",
        taxCents: 0,
        selfAssessedCents: 200,
        exchangeRate: 2,
      },
    ],
    purchaseCredits: [
      {
        ...row,
        id: "credit",
        taxTreatment: "reverse_charge",
        netCents: 250,
        taxCents: 0,
        selfAssessedCents: 50,
        exchangeRate: 2,
      },
    ],
  });
  // Sales tax 200+200; reverse charge 400-100; taxable/zero/exempt sales 4000;
  // purchases 2000-500. Reverse tax is both due and reclaimable.
  assert.equal(report.documentCount, 7);
  assert.deepEqual(
    report.boxes.map((box) => box.cents),
    [400, 300, 700, 300, 400, 4000, 1500, 1000, 1000],
  );
  assert.deepEqual(report.sales.out_of_scope, { netCents: 1000, taxCents: 0 });
  assert.deepEqual(report.purchases.reverse_charge, {
    netCents: 1500,
    taxCents: 0,
  });
  const empty = computeTaxReturn({ ...period, sales: [], purchases: [] });
  assert.equal(empty.documentCount, 0);
  assert.ok(empty.boxes.every((box) => box.cents === 0));
  assert.deepEqual(empty.sales.out_of_scope, { netCents: 0, taxCents: 0 });
});

test("self-assessment belongs only to reverse-charge purchases, never sales or standard purchases", () => {
  const period = { startDate: "2024-02-01", endDate: "2024-02-29" };
  const row = {
    id: "document",
    date: "2024-02-29",
    status: "paid",
    netCents: 1000,
    taxCents: 0,
    selfAssessedCents: 200,
    taxTreatment: "reverse_charge" as const,
  };
  const sales = computeTaxReturn({ ...period, sales: [row], purchases: [] });
  assert.equal(sales.boxes.find((box) => box.key === "2")?.cents, 0);
  assert.equal(sales.boxes.find((box) => box.key === "4")?.cents, 0);
  const saleCredits = computeTaxReturn({
    ...period,
    sales: [],
    salesCredits: [row],
    purchases: [],
  });
  assert.equal(saleCredits.boxes.find((box) => box.key === "2")?.cents, 0);
  assert.equal(saleCredits.boxes.find((box) => box.key === "4")?.cents, 0);
  const purchase = computeTaxReturn({
    ...period,
    sales: [],
    purchases: [
      {
        ...row,
        taxTreatment: "standard",
        taxCents: 200,
        selfAssessedCents: 500,
      },
    ],
  });
  assert.equal(purchase.boxes.find((box) => box.key === "2")?.cents, 0);
  assert.equal(purchase.boxes.find((box) => box.key === "4")?.cents, 200);
});

test("a legacy tax-inclusive discount lowers the gross before deriving its net", () => {
  // 120.00 gross minus 12.00 discount = 108.00; at 20%, 90.00 net + 18.00 tax.
  assert.equal(
    calculateDocumentNet({
      amountCents: 12000,
      discountCents: 1200,
      taxRate: 20,
      taxInclusive: true,
    }),
    9000,
  );
});

test("fractional percentage parts keep their declared units in a computed tax code", () => {
  const code = {
    id: "small",
    name: "Two percentage parts",
    treatment: "standard" as const,
    components: [
      { name: "Small", rate: 0.5 },
      { name: "Other", rate: 20 },
    ],
  };
  const tax = computeTax(10000, code);
  assert.deepEqual(
    tax.components.map((part) => part.taxCents),
    [50, 2000],
  );
  assert.equal(tax.taxCents, 2050);
});
