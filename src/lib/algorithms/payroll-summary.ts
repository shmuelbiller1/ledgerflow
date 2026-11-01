import { AlgorithmDefinition, AlgoResult } from './types';
import { currencyChartValue, formatCurrency } from '../../lib/utils';
import { computePeriodPayroll, PAYROLL_DISCLAIMER } from '../../lib/payroll-engine';

export const PAYROLL_SUMMARY_ALGO: AlgorithmDefinition = {
  id: 'payroll-summary',
  name: 'Payroll Liability Summary',
  domain: 'operations',
  tags: ['Reporting', 'HR', 'Payroll'],
  description: 'Simulates a payroll run for all active employees to determine net pay and employer tax burdens per pay period.',
  requires: ['transactions'],
  inputs: [
    {
      kind: 'select',
      key: 'year',
      label: 'Tax Year',
      options: [
        { value: '2027', label: '2027' },
        { value: '2026', label: '2026' },
        { value: '2025', label: '2025' }
      ],
      defaultValue: '2026'
    }
  ],
  compute: (ctx, inputs: { "year": string; [key: string]: unknown }): AlgoResult => {
    const employees = ctx.entities?.employees || [];
    const year = Number.parseInt(inputs['year'] || '2026', 10);
    
    const activeEmployees = employees.filter((e) => e.status === 'Active');

    if (activeEmployees.length === 0) {
      return {
        metrics: [],
        charts: [],
        insights: ["No active employees found in this workspace."],
        rows: []
      };
    }

    const chartData: { employee: string; net: number; taxes: number; burden: number }[] = [];
    const rows: ({ id: string; employee: string; role: string; frequency: string; gross: string; taxes: string; net: string; employerBurden: string })[] = [];
    
    let totalGross = 0;
    let totalNet = 0;
    let totalEmployerBurden = 0;
    let totalLiability = 0;

    activeEmployees.forEach(emp => {
      const breakdown = computePeriodPayroll(emp, year);
      
      totalGross += breakdown.grossPayCents;
      totalNet += breakdown.netPayCents;
      totalEmployerBurden += breakdown.totalEmployerTaxCents;
      totalLiability += breakdown.totalPeriodLiabilityCents;
      
      chartData.push({ employee: emp.name, net: currencyChartValue(breakdown.netPayCents), taxes: currencyChartValue(breakdown.totalWithholdingCents), burden: currencyChartValue(breakdown.totalEmployerTaxCents) });
      rows.push({
        id: emp.id,
        employee: emp.name,
        role: emp.role,
        frequency: emp.payFrequency,
        gross: formatCurrency(breakdown.grossPayCents),
        taxes: formatCurrency(breakdown.totalWithholdingCents),
        net: formatCurrency(breakdown.netPayCents),
        employerBurden: formatCurrency(breakdown.totalEmployerTaxCents)
      });
    });

    return {
      metrics: [
        { label: 'Total Gross Pay', value: formatCurrency(totalGross), color: 'text-white' },
        { label: 'Total Net Pay', value: formatCurrency(totalNet), color: 'text-indigo-400' },
        { label: 'Total Employer Taxes', value: formatCurrency(totalEmployerBurden), color: 'text-amber-400' },
        { label: 'Total Period Liability', value: formatCurrency(totalLiability), color: 'text-rose-400' }
      ],
      charts: [
        {
          config: {
            xKey: 'employee',
            yKeys: [
              { key: 'net', name: 'Net Pay', color: '#818cf8', type: 'bar' },
              { key: 'taxes', name: 'Employee Withholding', color: '#f87171', type: 'bar' },
              { key: 'burden', name: 'Employer Burden', color: '#fbbf24', type: 'bar' }
            ]
          },
          data: chartData
        }
      ],
      insights: [
        `Running payroll for ${activeEmployees.length} active employees will require ${formatCurrency(totalLiability)} in cash.`,
        `Employer tax burden represents ${((totalEmployerBurden / totalGross) * 100).toFixed(2)}% of gross wages.`,
        `Notice: ${PAYROLL_DISCLAIMER}`
      ],
      rows
    };
  }
};
