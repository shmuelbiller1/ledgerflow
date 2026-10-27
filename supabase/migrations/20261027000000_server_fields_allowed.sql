-- The guard checks every field of a document on each user save, so a field only the server writes,
-- once written, made every later user save of that document fail ("Field ... is not allowed").
-- Seen 27 Oct on the live site: the setup wizard could not save the business (workspaces with
-- `modules`, `setupCompletedAt`, `branding`, ...); a customer with a portal link could not be edited.
-- These fields are now allowed and unchangeable by users; the server (lf_is_client() false) still
-- writes them. A name already listed is harmless (the guard tests `= any`).

update public.lf_rules
set allowed_keys = allowed_keys || array[
      'numberingSeries', 'retention', 'setupCompletedAt', 'openingBalanceDate', 'branding', 'scheduledReportsSent',
      'closeSteps', 'ledgerHealth', 'alerts', 'alertsSent', 'payrollApproval', 'requireTwoStep', 'refuseNegativeStock',
      'modules', 'goodsLeaveWith', 'allocationRules', 'priceLists', 'salesReps', 'twoPersonRule', 'roleDashboards',
      'approvalDelegates', 'taxProfiles', 'brandingProfiles', 'expensePolicy', 'budgetControl'
    ],
    immutable_keys = immutable_keys || array[
      'numberingSeries', 'retention', 'setupCompletedAt', 'openingBalanceDate', 'branding', 'scheduledReportsSent',
      'closeSteps', 'ledgerHealth', 'alerts', 'alertsSent', 'payrollApproval', 'requireTwoStep', 'refuseNegativeStock',
      'modules', 'goodsLeaveWith', 'allocationRules', 'priceLists', 'salesReps', 'twoPersonRule', 'roleDashboards',
      'approvalDelegates', 'taxProfiles', 'brandingProfiles', 'expensePolicy', 'budgetControl'
    ]
where table_name = 'workspaces';

update public.lf_rules
set allowed_keys = allowed_keys || array['portalToken', 'portalTokenAt'],
    immutable_keys = immutable_keys || array['portalToken', 'portalTokenAt']
where table_name = 'customers';

update public.lf_rules
set allowed_keys = allowed_keys || array[
      'exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods'
    ],
    immutable_keys = immutable_keys || array[
      'exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods'
    ]
where table_name = 'creditNotes';

update public.lf_rules
set allowed_keys = allowed_keys || array[
      'exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods'
    ],
    immutable_keys = immutable_keys || array[
      'exchangeRate', 'tags', 'metadata', 'taxAmountCents', 'taxInclusive', 'taxVersion', 'taxTreatment', 'refundedCents', 'returnedGoods'
    ]
where table_name = 'vendorCredits';
