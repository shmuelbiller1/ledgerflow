import { ChartAccount } from '../../types';
import { lineAmount } from '../../lib/txFilters';
import { AlgorithmDefinition } from './types';

function normalize(description: string): string {
  return description
    .toUpperCase()
    .replace(/\d+/g, "")
    .replace(/[^A-Z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const CATEGORIZATION_CONSISTENCY_ALGO: AlgorithmDefinition = {
  id: 'forensics_categorization_consistency',
  name: 'Categorization Consistency Checker',
  domain: 'forensics',
  tags: ['audit', 'categorization', 'consistency', 'nlp'],
  description: 'Analyzes historical categorization patterns and flags transactions that deviate from highly consistent historical routing.',
  inputs: [
    { key: 'consistencyThreshold', label: 'Minimum Consistency Ratio', min: 0.5, max: 0.95, step: 0.05, defaultValue: 0.8 }
  ],
  compute: (ctx, inputs: { "consistencyThreshold": number; [key: string]: unknown }) => {
    const { transactions, accounts } = ctx;
    const consistencyThreshold = inputs['consistencyThreshold'] ?? 0.8;
    const targetDomain = 'expense'; // default to only analyzing expenses
    
    // Create a fast lookup for accounts
    const accountMap = new Map<string, ChartAccount>();
    for (const a of accounts) accountMap.set(a.id, a);

    // Extract history
    const history: { description: string; accountId: string; txId: string; amountCents: number; date: string }[] = [];
    
    for (const tx of transactions) {
      if (!tx.description) continue;
      // Assume the most significant line in the target domain is the categorization target
      // e.g., finding the first expense line for an expense transaction
      const targetLine = tx.lines.find(l => {
        const acc = accountMap.get(l.accountId);
        return acc && (acc.type as string) === targetDomain;
      });

      if (targetLine) {
        history.push({
          description: tx.description,
          accountId: targetLine.accountId,
          txId: tx.id,
          amountCents: tx.lines.reduce((sum, line) => sum + Math.max(0, lineAmount(line, tx)), 0),
          date: tx.date
        });
      }
    }

    // 1. Find Exact Match Consistency Issues
    // Group by normalized description
    const groups = new Map<string, typeof history>();
    for (const h of history) {
      const norm = normalize(h.description);
      if (!norm) continue;
      const group = groups.get(norm) ?? [];
      group.push(h);
      groups.set(norm, group);
    }

    const exactMatchAnomalies = [];
    let wellCategorizedGroups = 0;

    for (const [, items] of groups.entries()) {
      if (items.length < 3) continue; // Not enough history to judge consistency
      
      // Count categorizations for this exact normalized description
      const counts = new Map<string, number>();
      for (const item of items) {
        counts.set(item.accountId, (counts.get(item.accountId) ?? 0) + 1);
      }
      
      // Find the dominant category
      let dominantAcc = '';
      let maxCount = 0;
      for (const [acc, count] of counts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          dominantAcc = acc;
        }
      }
      
      const consistency = maxCount / items.length;
      
      if (consistency >= consistencyThreshold && consistency < 1.0) {
        // Flag the minority items as potential anomalies
        for (const item of items) {
          if (item.accountId !== dominantAcc) {
            exactMatchAnomalies.push({
              ...item,
              dominantAccountId: dominantAcc,
              dominantAccountName: accountMap.get(dominantAcc)?.name ?? 'Unknown',
              currentAccountName: accountMap.get(item.accountId)?.name ?? 'Unknown',
              consistency: consistency,
              totalSeen: items.length
            });
          }
        }
      } else if (consistency === 1.0) {
        wellCategorizedGroups++;
      }
    }

    const metrics = [
      { 
        label: "Categorization Anomalies", 
        value: exactMatchAnomalies.length, 
        color: exactMatchAnomalies.length > 0 ? "text-amber-500" : "text-emerald-500" 
      },
      {
        label: "Analyzed Patterns",
        value: groups.size
      },
      {
        label: "Highly Consistent Patterns",
        value: wellCategorizedGroups,
        color: "text-emerald-500"
      }
    ];

    const insights: string[] = [];
    if (exactMatchAnomalies.length > 0) {
      insights.push(`Found ${exactMatchAnomalies.length} transactions that violate established categorization patterns.`);
    } else {
      insights.push("All recurring transaction patterns appear to be consistently categorized.");
    }

    const charts = [];
    if (exactMatchAnomalies.length > 0) {
      // Create a chart showing anomalies by account
      const anomaliesByAcc = new Map<string, number>();
      for (const a of exactMatchAnomalies) {
        const name = a.currentAccountName;
        anomaliesByAcc.set(name, (anomaliesByAcc.get(name) ?? 0) + 1);
      }
      
      charts.push({
        data: Array.from(anomaliesByAcc.entries()).map(([name, count]) => ({
          account: name,
          anomalies: count
        })),
        config: {
          xKey: 'account',
          yKeys: [{ key: 'anomalies', color: '#ef4444', name: 'Anomalies', type: 'bar' as const }]
        }
      });
    }

    return {
      metrics,
      charts,
      insights
    };
  }
};
