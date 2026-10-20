import type { TableSpec } from './tax-table-validation';
/** Explicit units and business identities; rows are imported, never copied or changed. */
export const TAX_TABLES: readonly TableSpec[] = [
  {
    "file": "caFilingCalendar.ts",
    "name": "CA_FILING_CALENDAR",
    "keys": [
      "tax",
      "province?",
      "frequency"
    ]
  },
  {
    "file": "caSalesTax.ts",
    "name": "CA_SALES_TAX",
    "keys": [
      "province",
      "kind"
    ],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "euVat.ts",
    "name": "EU_VAT_RATES",
    "keys": [
      "country",
      "kind",
      "appliesTo?"
    ],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "ilAdvanceTaxCalendar.ts",
    "name": "IL_ADVANCE_TAX_SCHEDULE",
    "keys": [
      "frequency"
    ]
  },
  {
    "file": "ilAllocation.ts",
    "name": "IL_ALLOCATION_THRESHOLD",
    "keys": [],
    "amounts": [
      "rate"
    ]
  },
  {
    "file": "ilVat.ts",
    "name": "IL_VAT_SPECIAL_AREAS",
    "keys": [
      "area"
    ],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "ilSelfEmploymentNationalInsurance.ts",
    "name": "IL_SELF_EMPLOYMENT_NI_ROWS",
    "keys": [],
    "amounts": [
      "minMonthlyIncomeCents",
      "reducedBandCeilingCents",
      "maxMonthlyIncomeCents",
      "publishedMinMonthlyAdvanceCents?",
      "publishedMaxMonthlyAdvanceCents?",
      "averageMonthlyWageCents?"
    ]
  },
  {
    "file": "ilOsekPaturThresholds.ts",
    "name": "IL_OSEK_PATUR_CEILINGS",
    "keys": [],
    "amounts": [
      "ceilingCents"
    ],
    "mode": "year"
  },
  {
    "file": "ilVatRates.ts",
    "name": "IL_VAT_STANDARD",
    "keys": [],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "ilVatFilingFrequency.ts",
    "name": "IL_VAT_REPORT_FREQUENCY",
    "keys": [
      "frequency"
    ]
  },
  {
    "file": "ilWithholdingDefaults.ts",
    "name": "IL_WITHHOLDING_DEFAULTS",
    "keys": [
      "paymentType",
      "residence",
      "payeeKind?"
    ],
    "percentages": [
      "ratePercent"
    ]
  },
  {
    "file": "registrationThresholds.ts",
    "name": "REGISTRATION_THRESHOLDS",
    "keys": [
      "scheme",
      "window"
    ],
    "amounts": [
      "thresholdCents"
    ]
  },
  {
    "file": "ukVat.ts",
    "name": "UK_VAT_RATES",
    "keys": [
      "kind",
      "appliesTo?"
    ],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "ukVatSchemes.ts",
    "name": "UK_FRS_CATEGORIES",
    "keys": [
      "category"
    ],
    "percentages": [
      "percent"
    ]
  },
  {
    "file": "ukVatSchemes.ts",
    "name": "UK_VAT_SCHEME_THRESHOLDS",
    "keys": [
      "id"
    ],
    "amounts": [
      "thresholdCents"
    ]
  },
  {
    "file": "us1099Thresholds.ts",
    "name": "US_1099_THRESHOLDS",
    "keys": [
      "kind",
      "form"
    ],
    "amounts": [
      "thresholdCents"
    ]
  },
  {
    "file": "us1099Preview.ts",
    "name": "US1099_THRESHOLDS",
    "keys": [],
    "amounts": [
      "necCents",
      "miscOrdinaryCents"
    ]
  },
  {
    "file": "usDigitalTaxability.ts",
    "name": "US_DIGITAL_TAXABILITY",
    "keys": [
      "state",
      "subtype"
    ],
    "fractions": [
      "rate?"
    ]
  },
  {
    "file": "usExemptionCertificates.ts",
    "name": "US_EXEMPTION_CERTIFICATE_TYPES",
    "keys": [
      "id"
    ]
  },
  {
    "file": "usExemptionCertificates.ts",
    "name": "SST_MEMBER_ROW",
    "keys": [],
    "mode": "metadata"
  },
  {
    "file": "usFilingCalendar.ts",
    "name": "US_FILING_CALENDAR",
    "keys": [
      "state"
    ]
  },
  {
    "file": "usMarketplaceFacilitator.ts",
    "name": "US_MARKETPLACE_FACILITATORS",
    "keys": [
      "state"
    ]
  },
  {
    "file": "usNexus.ts",
    "name": "US_NEXUS_THRESHOLDS",
    "keys": [
      "state"
    ]
  },
  {
    "file": "usProductTaxability.ts",
    "name": "US_PRODUCT_TAXABILITY",
    "keys": [
      "state",
      "category"
    ],
    "fractions": [
      "rate?"
    ]
  },
  {
    "file": "usSalesTaxHolidayCalendar.ts",
    "name": "US_SALES_TAX_HOLIDAY_CALENDAR",
    "keys": [
      "state",
      "name"
    ],
    "mode": "holiday"
  },
  {
    "file": "usSalesTaxHolidays.ts",
    "name": "US_SALES_TAX_HOLIDAYS",
    "keys": [
      "state",
      "name",
      "bandId"
    ],
    "amounts": [
      "capCents"
    ],
    "mode": "holiday"
  },
  {
    "file": "usStateSalesTax.ts",
    "name": "US_STATE_SALES_TAX",
    "keys": [
      "state"
    ],
    "fractions": [
      "rate"
    ]
  },
  {
    "file": "usW2Review.ts",
    "name": "US_W2_REVIEW_YEARS",
    "keys": [],
    "amounts": [
      "socialSecurityWageBaseCents"
    ],
    "mode": "year"
  },
  {
    "file": "vatNumberFormat.ts",
    "name": "VAT_COUNTRY_FORMATS",
    "keys": [
      "country"
    ],
    "mode": "reference"
  },
  {
    "file": "usMileageRates.ts",
    "name": "US_MILEAGE_RATES",
    "keys": [],
    "amounts": [
      "rateCentsPerMile"
    ]
  }
];
/** Non-table modules are classified so a newly added module cannot silently escape review. */
export const NON_TABLE_MODULES: Readonly<Record<string, string>> = {
  "entityFilings.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "form856.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "form856ReviewExport.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "ilImportServices.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "ilVatReturn.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "israel102Review.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "israeliDocumentTypes.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "israeliIdentifiers.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "pcn874Draft.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "profile.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "resolveLineTax.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "ruleRateTable.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "stateLocalRateImporters.ts": "Import-time validation of supplied local-rate publications; no embedded legal rows.",
  "taxCategories.ts": "Application vocabulary, not a dated legal schedule.",
  "taxSuggestions.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "usNexusWatch.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "usSalesTaxReturn.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "usTaxIdFormat.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "usUseTax.ts": "Calculation, review, profile or document helper; no embedded dated source table.",
  "withholding.ts": "Calculation, review, profile or document helper; no embedded dated source table."
};
