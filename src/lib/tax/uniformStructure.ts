/**
 * E-54: Israeli Uniform Structure (מבנה אחיד / OPEN FORMAT) — research fixture.
 *
 * The Uniform Structure is the Israel Tax Authority's standard export format for computerized
 * accounting systems (Income Tax Regulations, הוראות ניהול פנקסים, spec version 1.31): two
 * fixed-width text files, `INI.TXT` (header/summary) and `BKMVDATA.TXT` (data), that any
 * registered accounting software must be able to produce for a computerized audit.
 *
 * This module is the research fixture for E-33 (the writer): it transcribes the spec's field
 * layouts (field numbers, widths, kinds) using third-party SHAAM CSV transcriptions and provides
 * the typed input shape the writer will consume, with a sample fixture. The official PDF could
 * not be retrieved here; direct official-source verification remains open. It does NOT write files,
 * calculate tax, or post anything. `readyForFiling` is always false: nothing here is filed.
 *
 * Sources (see docs/UNIFORM_STRUCTURE_RESEARCH.md for the full note):
 * - Israel Tax Authority, "הוראות להפקת קבצים במבנה אחיד", v1.31 (gov.il, horaot-131.pdf).
 * - Field tables cross-checked against the open-source SHAAM generator's CSV transcriptions
 *   (github.com/Urigo/accounter-fullstack, packages/shaam-uniform-format-generator/documentation).
 *
 * Pure: no store, no I/O.
 */

/** A single field of a Uniform Structure record, transcribed from the spec's field table. */
export interface UniformField {
  /** the authority's field number (e.g. 1204 for the C100 document number) */
  no: number;
  /** stable camelCase key used to fill the field */
  key: string;
  /** fixed width in characters (the spec's Length column) */
  width: number;
  /** numeric fields are zero-padded; text fields are space-padded */
  kind: 'num' | 'text';
  /** the authority's requirement column */
  required: 'Required' | 'Optional' | 'Conditional';
}

/** A record type of BKMVDATA.TXT (or INI.TXT) with its field layout in the authority's order. */
export interface UniformRecordLayout {
  code: string;
  /** total fixed width of one record, excluding the CRLF line ending */
  width: number;
  fields: readonly UniformField[];
}

const f = (no: number, key: string, width: number, kind: 'num' | 'text', required: UniformField['required'] = 'Required'): UniformField => ({ no, key, width, kind, required });

/** INI.TXT header record A000 (fields 1000–1035). */
export const UNIFORM_A000: UniformRecordLayout = {
  code: 'A000',
  width: 466,
  fields: [
    f(1000, 'recordCode', 4, 'text'),
    f(1001, 'reserved', 5, 'text'),
    f(1002, 'totalRecordsInBkmvdata', 15, 'num'),
    f(1003, 'taxId', 9, 'num'),
    f(1004, 'primaryIdentifier', 15, 'num'),
    f(1005, 'systemConstant', 8, 'text'),
    f(1006, 'softwareRegistrationNo', 8, 'num'),
    f(1007, 'softwareName', 20, 'text'),
    f(1008, 'softwareVersion', 20, 'text'),
    f(1009, 'softwareVendorTaxId', 9, 'num'),
    f(1010, 'softwareVendorName', 20, 'text'),
    f(1011, 'softwareType', 1, 'num'),
    f(1012, 'fileOutputPath', 50, 'text'),
    f(1013, 'accountingType', 1, 'num'),
    f(1014, 'balanceRequired', 1, 'num', 'Conditional'),
    f(1015, 'companyRegistrarId', 9, 'num', 'Optional'),
    f(1016, 'withholdingFileNo', 9, 'num', 'Optional'),
    f(1017, 'reserved', 10, 'text', 'Optional'),
    f(1018, 'businessName', 50, 'text'),
    f(1019, 'businessStreet', 50, 'text', 'Optional'),
    f(1020, 'businessHouseNo', 10, 'text', 'Optional'),
    f(1021, 'businessCity', 30, 'text', 'Optional'),
    f(1022, 'businessZip', 8, 'text', 'Optional'),
    f(1023, 'taxYear', 4, 'num', 'Conditional'),
    f(1024, 'startDate', 8, 'num', 'Conditional'),
    f(1025, 'endDate', 8, 'num', 'Conditional'),
    f(1026, 'processStartDate', 8, 'num'),
    f(1027, 'processStartTime', 4, 'num'),
    f(1028, 'languageCode', 1, 'num'),
    f(1029, 'characterEncoding', 1, 'num'),
    f(1030, 'compressionSoftwareName', 20, 'text', 'Optional'),
    f(1031, 'reserved', 0, 'text', 'Optional'),
    f(1032, 'baseCurrencyCode', 3, 'text', 'Optional'),
    f(1033, 'reserved', 0, 'text', 'Optional'),
    f(1034, 'branchInfoFlag', 1, 'num'),
    f(1035, 'reserved', 46, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT opening record A100 (fields 1100–1105). */
export const UNIFORM_A100: UniformRecordLayout = {
  code: 'A100',
  width: 95,
  fields: [
    f(1100, 'recordCode', 4, 'text'),
    f(1101, 'recordNoInFile', 9, 'num'),
    f(1102, 'taxId', 9, 'num'),
    f(1103, 'primaryIdentifier', 15, 'num'),
    f(1104, 'systemConstant', 8, 'text'),
    f(1105, 'reserved', 50, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT journal-entry line record B100 (fields 1350–1377). */
export const UNIFORM_B100: UniformRecordLayout = {
  code: 'B100',
  width: 317,
  fields: [
    f(1350, 'recordCode', 4, 'text'),
    f(1351, 'recordNoInFile', 9, 'num'),
    f(1352, 'taxId', 9, 'num'),
    f(1353, 'transactionNo', 10, 'num'),
    f(1354, 'transactionLineNo', 5, 'num'),
    f(1355, 'batchNo', 8, 'num', 'Optional'),
    f(1356, 'transactionType', 15, 'text', 'Optional'),
    f(1357, 'referenceDocument', 20, 'text', 'Optional'),
    f(1358, 'referenceDocumentType', 3, 'num', 'Optional'),
    f(1359, 'referenceDocument2', 20, 'text', 'Optional'),
    f(1360, 'referenceDocumentType2', 3, 'num', 'Optional'),
    f(1361, 'details', 50, 'text', 'Optional'),
    f(1362, 'date', 8, 'num'),
    f(1363, 'valueDate', 8, 'num'),
    f(1364, 'accountKey', 15, 'text'),
    f(1365, 'counterAccountKey', 15, 'text', 'Optional'),
    f(1366, 'debitCreditIndicator', 1, 'num'),
    f(1367, 'currencyCode', 3, 'text', 'Optional'),
    f(1368, 'amountLocal', 15, 'text'),
    f(1369, 'amountForeign', 15, 'text', 'Optional'),
    f(1370, 'quantityField', 12, 'text', 'Optional'),
    f(1371, 'matchingField1', 10, 'text', 'Optional'),
    f(1372, 'matchingField2', 10, 'text', 'Optional'),
    f(1373, 'reserved', 0, 'text', 'Optional'),
    f(1374, 'branchId', 7, 'text', 'Conditional'),
    f(1375, 'entryDate', 8, 'num'),
    f(1376, 'operatorUsername', 9, 'text', 'Optional'),
    f(1377, 'reserved', 25, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT account record B110 (fields 1400–1424). */
export const UNIFORM_B110: UniformRecordLayout = {
  code: 'B110',
  width: 376,
  fields: [
    f(1400, 'recordCode', 4, 'text'),
    f(1401, 'recordNoInFile', 9, 'num'),
    f(1402, 'taxId', 9, 'num'),
    f(1403, 'accountKey', 15, 'text'),
    f(1404, 'accountName', 50, 'text'),
    f(1405, 'trialBalanceCode', 15, 'text'),
    f(1406, 'trialBalanceCodeDescription', 30, 'text'),
    f(1407, 'customerStreet', 50, 'text', 'Optional'),
    f(1408, 'customerHouseNo', 10, 'text', 'Optional'),
    f(1409, 'customerCity', 30, 'text', 'Optional'),
    f(1410, 'customerZip', 8, 'text', 'Optional'),
    f(1411, 'customerCountry', 30, 'text', 'Optional'),
    f(1412, 'customerCountryCode', 2, 'text', 'Optional'),
    f(1413, 'parentAccountKey', 15, 'text', 'Optional'),
    f(1414, 'openingBalance', 15, 'text', 'Optional'),
    f(1415, 'totalDebits', 15, 'text', 'Optional'),
    f(1416, 'totalCredits', 15, 'text', 'Optional'),
    f(1417, 'accountingClassificationCode', 4, 'num', 'Conditional'),
    f(1418, 'reserved', 0, 'text', 'Optional'),
    f(1419, 'customerTaxId', 9, 'num', 'Conditional'),
    f(1420, 'reserved', 0, 'text', 'Optional'),
    f(1421, 'branchId', 7, 'text', 'Conditional'),
    f(1422, 'openingBalanceForeign', 15, 'text', 'Optional'),
    f(1423, 'openingBalanceCurrencyCode', 3, 'text', 'Optional'),
    f(1424, 'reserved', 16, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT document-header record C100 (fields 1200–1235). */
export const UNIFORM_C100: UniformRecordLayout = {
  code: 'C100',
  width: 445,
  fields: [
    f(1200, 'recordCode', 4, 'text'),
    f(1201, 'recordNoInFile', 9, 'num'),
    f(1202, 'taxId', 9, 'num'),
    f(1203, 'documentType', 3, 'num'),
    f(1204, 'documentNo', 20, 'text'),
    f(1205, 'documentIssueDate', 8, 'num'),
    f(1206, 'documentIssueTime', 4, 'num', 'Optional'),
    f(1207, 'customerName', 50, 'text', 'Optional'),
    f(1208, 'customerStreet', 50, 'text', 'Optional'),
    f(1209, 'customerHouseNo', 10, 'text', 'Optional'),
    f(1210, 'customerCity', 30, 'text', 'Optional'),
    f(1211, 'customerZip', 8, 'text', 'Optional'),
    f(1212, 'customerCountry', 30, 'text', 'Optional'),
    f(1213, 'customerCountryCode', 2, 'text', 'Optional'),
    f(1214, 'customerPhone', 15, 'text', 'Optional'),
    f(1215, 'customerTaxId', 9, 'num', 'Optional'),
    f(1216, 'documentValueDate', 8, 'num', 'Optional'),
    f(1217, 'amountForeign', 15, 'text', 'Optional'),
    f(1218, 'currencyCode', 3, 'text', 'Optional'),
    f(1219, 'amountBeforeDiscount', 15, 'text', 'Optional'),
    f(1220, 'documentDiscount', 15, 'text', 'Optional'),
    f(1221, 'amountAfterDiscountExclVat', 15, 'text', 'Optional'),
    f(1222, 'vatAmount', 15, 'text', 'Optional'),
    f(1223, 'amountInclVat', 15, 'text', 'Optional'),
    f(1224, 'withholdingTaxAmount', 12, 'text', 'Optional'),
    f(1225, 'customerKey', 15, 'text', 'Optional'),
    f(1226, 'matchingField', 10, 'text', 'Optional'),
    f(1227, 'reserved', 8, 'text', 'Optional'),
    f(1228, 'cancelledDocument', 1, 'text', 'Optional'),
    f(1229, 'reserved', 8, 'text', 'Optional'),
    f(1230, 'documentDate', 7, 'num', 'Optional'),
    f(1231, 'branchId', 8, 'text', 'Optional'),
    f(1232, 'reserved', 1, 'text', 'Optional'),
    f(1233, 'actionExecutor', 13, 'text', 'Optional'),
    f(1234, 'reserved', 0, 'text', 'Optional'),
    f(1235, 'reserved', 0, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT document-line record D110 (fields 1250–1275). */
export const UNIFORM_D110: UniformRecordLayout = {
  code: 'D110',
  width: 339,
  fields: [
    f(1250, 'recordCode', 4, 'text'),
    f(1251, 'recordNoInFile', 9, 'num'),
    f(1252, 'taxId', 9, 'num'),
    f(1253, 'documentType', 3, 'num'),
    f(1254, 'documentNo', 20, 'text'),
    f(1255, 'lineNo', 4, 'num'),
    f(1256, 'baseDocumentType', 3, 'num', 'Conditional'),
    f(1257, 'baseDocumentNo', 20, 'text', 'Conditional'),
    f(1258, 'transactionType', 1, 'num', 'Optional'),
    f(1259, 'internalCatalogCode', 20, 'text', 'Optional'),
    f(1260, 'description', 30, 'text'),
    f(1261, 'manufacturerName', 50, 'text', 'Optional'),
    f(1262, 'serialNumber', 30, 'text', 'Optional'),
    f(1263, 'unitOfMeasure', 20, 'text', 'Optional'),
    f(1264, 'quantity', 17, 'text'),
    f(1265, 'unitPriceExclVat', 15, 'text', 'Optional'),
    f(1266, 'lineDiscount', 15, 'text', 'Optional'),
    f(1267, 'lineTotal', 15, 'text', 'Optional'),
    f(1268, 'vatRate', 4, 'num', 'Optional'),
    f(1269, 'reserved', 0, 'text', 'Optional'),
    f(1270, 'branchId', 7, 'text', 'Conditional'),
    f(1271, 'reserved', 0, 'text', 'Optional'),
    f(1272, 'documentDate', 8, 'num'),
    f(1273, 'headerLinkField', 7, 'num', 'Optional'),
    f(1274, 'baseDocumentBranchId', 7, 'text', 'Optional'),
    f(1275, 'reserved', 21, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT payment/receipt record D120 (fields 1300–1324). */
export const UNIFORM_D120: UniformRecordLayout = {
  code: 'D120',
  width: 222,
  fields: [
    f(1300, 'recordCode', 4, 'text'),
    f(1301, 'recordNoInFile', 9, 'num'),
    f(1302, 'taxId', 9, 'num'),
    f(1303, 'documentType', 3, 'num'),
    f(1304, 'documentNo', 20, 'text'),
    f(1305, 'lineNo', 4, 'num'),
    f(1306, 'paymentMethod', 1, 'num'),
    f(1307, 'bankNo', 10, 'num', 'Conditional'),
    f(1308, 'branchNo', 10, 'num', 'Conditional'),
    f(1309, 'accountNo', 15, 'num', 'Conditional'),
    f(1310, 'checkNo', 10, 'num', 'Conditional'),
    f(1311, 'paymentDueDate', 8, 'num', 'Optional'),
    f(1312, 'lineAmount', 15, 'text'),
    f(1313, 'acquirerCode', 1, 'num', 'Optional'),
    f(1314, 'cardBrand', 20, 'text', 'Optional'),
    f(1315, 'creditTransactionType', 1, 'num', 'Optional'),
    f(1316, 'reserved', 0, 'text', 'Optional'),
    f(1317, 'reserved', 0, 'text', 'Optional'),
    f(1318, 'reserved', 0, 'text', 'Optional'),
    f(1319, 'reserved', 0, 'text', 'Optional'),
    f(1320, 'branchId', 7, 'text', 'Conditional'),
    f(1321, 'reserved', 0, 'text', 'Optional'),
    f(1322, 'documentDate', 8, 'num'),
    f(1323, 'headerLinkField', 7, 'num', 'Optional'),
    f(1324, 'reserved', 60, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT inventory-item record M100 (fields 1450–1465). */
export const UNIFORM_M100: UniformRecordLayout = {
  code: 'M100',
  width: 294,
  fields: [
    f(1450, 'recordCode', 4, 'text'),
    f(1451, 'recordNoInFile', 9, 'num'),
    f(1452, 'taxId', 9, 'num'),
    f(1453, 'universalItemCode', 20, 'text', 'Optional'),
    f(1454, 'supplierItemCode', 20, 'text', 'Optional'),
    f(1455, 'internalItemCode', 20, 'text'),
    f(1456, 'itemName', 50, 'text'),
    f(1457, 'classificationCode', 10, 'text', 'Optional'),
    f(1458, 'classificationDescription', 30, 'text', 'Optional'),
    f(1459, 'unitOfMeasure', 20, 'text', 'Optional'),
    f(1460, 'openingStockQty', 12, 'text'),
    f(1461, 'totalStockIn', 12, 'text'),
    f(1462, 'totalStockOut', 12, 'text'),
    f(1463, 'endCostNonBonded', 8, 'num', 'Optional'),
    f(1464, 'endCostBonded', 8, 'num', 'Optional'),
    f(1465, 'reserved', 50, 'text', 'Optional'),
  ],
};

/** BKMVDATA.TXT closing record Z900 (fields 1150–1156). */
export const UNIFORM_Z900: UniformRecordLayout = {
  code: 'Z900',
  width: 110,
  fields: [
    f(1150, 'recordCode', 4, 'text'),
    f(1151, 'recordNoInFile', 9, 'num'),
    f(1152, 'taxId', 9, 'num'),
    f(1153, 'primaryIdentifier', 15, 'num'),
    f(1154, 'systemConstant', 8, 'text'),
    f(1155, 'totalRecordsInFile', 15, 'num'),
    f(1156, 'reserved', 50, 'text', 'Optional'),
  ],
};

/** Every Uniform Structure record layout, in file order. */
export const UNIFORM_RECORD_LAYOUTS: readonly UniformRecordLayout[] = [
  UNIFORM_A000,
  UNIFORM_A100,
  UNIFORM_B100,
  UNIFORM_B110,
  UNIFORM_C100,
  UNIFORM_D110,
  UNIFORM_D120,
  UNIFORM_M100,
  UNIFORM_Z900,
];

/** The spec's system constant, written in fields 1005 (A000), 1104 (A100) and 1154 (Z900). */
export const UNIFORM_SYSTEM_CONSTANT = '&OF1.31&';

/** Document type codes (spec Appendix 1). */
export const UNIFORM_DOCUMENT_TYPES = {
  '100': 'Order',
  '200': 'Delivery Note',
  '210': 'Return Note',
  '300': 'Invoice / Transaction Invoice',
  '305': 'Tax Invoice',
  '320': 'Tax Invoice / Receipt',
  '325': 'Credit Note',
  '330': 'Credit Tax Invoice',
  '340': 'Receipt',
  '400': 'Debit Note',
  '410': 'General Credit Note',
  '420': 'Transfer Note',
  '430': 'Purchase Document',
  '500': 'Supplier Invoice',
  '600': 'Consolidated Receipt',
  '700': 'Credit Card Charge / Credit',
  '710': 'Credit Card Receipt',
} as const;

export type UniformDocumentType = keyof typeof UNIFORM_DOCUMENT_TYPES;

/** Payment method codes (D120 field 1306). */
export const UNIFORM_PAYMENT_METHODS = {
  '1': 'Cash',
  '2': 'Check',
  '3': 'Credit card',
  '4': 'Bank transfer',
  '5': 'Voucher',
  '6': 'Exchange slip',
  '7': 'Promissory note',
  '8': 'Standing order',
  '9': 'Other',
} as const;

export type UniformPaymentMethod = keyof typeof UNIFORM_PAYMENT_METHODS;

/**
 * The typed input the E-33 writer will consume: one business, its accounts, journal entries,
 * documents (each with lines and payments) and inventory items. Amounts are whole agorot (the
 * books' minor units); the writer formats them as the spec's implied-decimal fields.
 */
export interface UniformFixtureInput {
  business: {
    taxId: string;
    name: string;
    street?: string;
    houseNo?: string;
    city?: string;
    zip?: string;
    taxYear: string;
    startDate: string;
    endDate: string;
  };
  accounts: Array<{
    accountKey: string;
    accountName: string;
    trialBalanceCode: string;
    trialBalanceCodeDescription: string;
    openingBalanceCents?: number;
    totalDebitsCents?: number;
    totalCreditsCents?: number;
  }>;
  journalEntries: Array<{
    transactionNo: string;
    date: string;
    valueDate: string;
    accountKey: string;
    debitCredit: '1' | '2';
    amountCents: number;
    details?: string;
  }>;
  documents: Array<{
    documentType: UniformDocumentType;
    documentNo: string;
    issueDate: string;
    customerName?: string;
    customerTaxId?: string;
    amountInclVatCents?: number;
    vatAmountCents?: number;
    amountAfterDiscountExclVatCents?: number;
    lines: Array<{
      description: string;
      quantity: number;
      unitPriceExclVatCents?: number;
      vatRatePercent?: number;
    }>;
    payments: Array<{
      paymentMethod: UniformPaymentMethod;
      amountCents: number;
      /** E-33: the payment's own day (YYYYMMDD) for D120 field 1322; falls back to the document's issue date. */
      date?: string;
    }>;
  }>;
  inventory: Array<{
    internalItemCode: string;
    itemName: string;
    openingStockQty: number;
    totalStockIn: number;
    totalStockOut: number;
  }>;
}

/**
 * A small, realistic sample: one Israeli business, three accounts, two journal lines, one tax
 * invoice with two lines and a cash payment, and one inventory item. The E-33 writer's tests
 * will generate INI.TXT + BKMVDATA.TXT from this fixture and check the record widths and counts.
 */
export const UNIFORM_FIXTURE: UniformFixtureInput = {
  business: {
    taxId: '512345678',
    name: 'Example Consulting Ltd.',
    street: 'Herzl',
    houseNo: '12',
    city: 'Tel Aviv',
    zip: '6100001',
    taxYear: '2025',
    startDate: '20250101',
    endDate: '20251231',
  },
  accounts: [
    {
      accountKey: '1000',
      accountName: 'Cash',
      trialBalanceCode: '1000',
      trialBalanceCodeDescription: 'Cash and bank',
      openingBalanceCents: 0,
      totalDebitsCents: 1180000,
      totalCreditsCents: 0,
    },
    {
      accountKey: '4000',
      accountName: 'Sales',
      trialBalanceCode: '4000',
      trialBalanceCodeDescription: 'Revenue',
      totalDebitsCents: 0,
      totalCreditsCents: 1000000,
    },
    {
      accountKey: '2100',
      accountName: 'VAT Payable',
      trialBalanceCode: '2100',
      trialBalanceCodeDescription: 'Liabilities',
      totalDebitsCents: 0,
      totalCreditsCents: 180000,
    },
  ],
  journalEntries: [
    {
      transactionNo: '1',
      date: '20250115',
      valueDate: '20250115',
      accountKey: '1000',
      debitCredit: '1',
      amountCents: 1180000,
      details: 'Tax invoice 1001 cash receipt',
    },
    {
      transactionNo: '1',
      date: '20250115',
      valueDate: '20250115',
      accountKey: '4000',
      debitCredit: '2',
      amountCents: 1000000,
      details: 'Tax invoice 1001 cash receipt',
    },
    {
      transactionNo: '1',
      date: '20250115',
      valueDate: '20250115',
      accountKey: '2100',
      debitCredit: '2',
      amountCents: 180000,
      details: 'Tax invoice 1001 VAT',
    },
  ],
  documents: [
    {
      documentType: '305',
      documentNo: '1001',
      issueDate: '20250115',
      customerName: 'Acme Corp',
      customerTaxId: '514000111',
      amountAfterDiscountExclVatCents: 1000000,
      vatAmountCents: 180000,
      amountInclVatCents: 1180000,
      lines: [
        { description: 'Consulting services', quantity: 10, unitPriceExclVatCents: 100000, vatRatePercent: 18 },
      ],
      payments: [{ paymentMethod: '1', amountCents: 1180000 }],
    },
  ],
  inventory: [
    {
      internalItemCode: 'WIDGET-1',
      itemName: 'Standard widget',
      openingStockQty: 100,
      totalStockIn: 50,
      totalStockOut: 30,
    },
  ],
};
