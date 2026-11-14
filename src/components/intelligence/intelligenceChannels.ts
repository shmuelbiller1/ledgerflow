
import type { LucideIcon } from 'lucide-react';

import { BarChart3, ShieldCheck, Target, TrendingUp, Activity, LayoutGrid, Building, DollarSign, Users, BarChart as BarChartIcon, Calculator, Zap } from 'lucide-react';

import { FINANCIAL_ALGORITHMS } from '../../lib/financial-algorithms';

export interface ChannelItem {
  id: string;
  icon: LucideIcon;
  label: Record<string, string>;
  desc?: Record<string, string>;
  name?: string;
  description?: string;
  badge?: string;
}

export const CHANNELS: { group: Record<string, string>; items: ChannelItem[] }[] = [
  {
    group: { en: 'Executive Overview', he: 'סקירת מנהלים' },
    items: [
      { id: 'radar', icon: Activity, label: { en: 'Metrics Radar', he: 'רדאר מדדים' }, desc: { en: 'Live volumetric operational spider web view', he: 'תצוגת רדאר תקציבית חיה' } },
      { id: 'roi', icon: Target, label: { en: 'ROI Matrix', he: 'מטריצת החזר השקעה' }, desc: { en: 'Calculates true velocity and margin projections', he: 'חישוב מהירות החזר השקעה' } }
    ]
  },
  {
    group: { en: 'Financial Core', he: 'פיננסים' },
    items: [
      { id: 'pivot', icon: LayoutGrid, label: { en: 'Compare', he: 'השוואה' }, desc: { en: 'Any label against any other, by month or payee', he: 'כל תווית מול כל תווית, לפי חודש או משלם' } },
      { id: 'budgets', icon: DollarSign, label: { en: 'Budget Analysis', he: 'ניתוח תקציב' }, desc: { en: 'Budget vs Actual variance reporting', he: 'דוחות סטיות של תקציב מול מציאות' } },
      { id: 'nexus', icon: ShieldCheck, label: { en: 'Tax Nexus', he: 'מיסוי מקומי' }, desc: { en: 'Identify tax liabilities across jurisdictions', he: 'זיהוי חבויות מס ברחבי המדינות' } },
      { id: 'entities', icon: Building, label: { en: 'Entity Consolidation', he: 'איחוד ישויות' }, desc: { en: 'Multi-company ledger aggregation', he: 'ריכוז ואיחוד ספרי הנהלת חשבונות' } },
      { id: 'forensics', icon: ShieldCheck, label: { en: 'Audit & Forensics', he: 'ביקורת וממצאים' }, desc: { en: 'Deep scan integrity ledger evaluation', he: 'סריקת עומק והערכת תקינות ספר יומן' } }
    ]
  },
  {
    group: { en: 'Calculators', he: 'מחשבונים' },
    items: [
      { id: 'breakeven', icon: Target, label: { en: 'Break-Even Analysis', he: 'ניתוח נקודת איזון' }, desc: { en: 'Calculate break-even units and revenue', he: 'חישוב יחידות והכנסות לנקודת איזון' } },
      { id: 'compound', icon: Calculator, label: { en: 'Compound Interest', he: 'ריבית דריבית' }, desc: { en: 'Calculate compounding investment returns', he: 'חישוב תשואות השקעה בריבית דריבית' } },
      { id: 'rule72', icon: Activity, label: { en: 'Rule of 72', he: 'כלל ה-72' }, desc: { en: 'Calculate years to double investment', he: 'חישוב שנים להכפלת השקעה' } },
      { id: 'ltv', icon: Users, label: { en: 'Customer Lifetime Value (LTV)', he: 'ערך חיי לקוח (LTV)' }, desc: { en: 'Customer Lifetime Value metrics', he: 'חישוב ערך חיי לקוח' } },
      { id: 'cac', icon: Users, label: { en: 'Customer Acquisition Cost (CAC)', he: 'עלות רכישת לקוח (CAC)' }, desc: { en: 'Customer Acquisition Cost metrics', he: 'חישוב עלות רכישת לקוח' } },
      { id: 'npv', icon: BarChartIcon, label: { en: 'Net Present Value (NPV)', he: 'ערך נוכחי נקי (NPV)' }, desc: { en: 'Discounted cash flow NPV calculator', he: 'חישוב ערך נוכחי נקי' } },
      { id: 'wacc', icon: BarChart3, label: { en: 'Weighted Average Cost of Capital (WACC)', he: 'עלות הון משוקללת (WACC)' }, desc: { en: 'Cost of capital computation', he: 'חישוב עלות הון משוקללת' } },
      { id: 'roas', icon: TrendingUp, label: { en: 'Return on Ad Spend (ROAS)', he: 'החזר על הוצאות פרסום (ROAS)' }, desc: { en: 'Ad campaign ROI calculation', he: 'חישוב תשואה על קמפיינים' } },
      { id: 'caprate', icon: Building, label: { en: 'Cap Rate', he: 'שיעור היוון נדל״ן' }, desc: { en: 'Real estate capitalization rate', he: 'שיעור היוון לנדל״ן' } },
      { id: 'ratios', icon: BarChart3, label: { en: 'Financial Ratios', he: 'יחסים פיננסיים' }, desc: { en: 'In-depth financial metric analysis', he: 'ניתוח עומק של יחסים ومדדים' } },
      { id: 'ebitda', icon: BarChart3, label: { en: 'EBITDA Calculator', he: 'מחשבון EBITDA' }, desc: { en: 'Earnings Before Interest, Taxes, Depreciation', he: 'רווח לפני ריבית, מסים ופחת' } }
    ]
  },
  {
    group: { en: 'Algorithmic Intelligence Tools', he: 'כלי בינה אלגוריתמיים' },
    items: Object.entries(FINANCIAL_ALGORITHMS).map(([id, algo]) => ({
      id,
      icon: Zap,
      label: { en: algo.name, he: algo.name },
      desc: { en: algo.description, he: algo.description }
    }))
  }
];

