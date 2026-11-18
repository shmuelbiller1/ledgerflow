import { useDialog } from '../../hooks/useDialog';
import { ModalShell } from '../ui/ModalShell';
import React, { useState } from 'react';
import { 
  Sparkles, 
  Wand2, 
  X, 
  ArrowRight, 
  Loader2, 
  CheckCircle2,
  AlertCircle,
  BookOpen,
  Layout
} from 'lucide-react';
import { aiService } from '../../services/aiService';
import { BUSINESS_TEMPLATES } from '../../lib/businessTemplates';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import { Labelled } from '../ui/Labelled';

interface AICustomBlueprintProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (template: import("../../services/aiService").GeneratedBlueprint) => void;
}

function withStableKeys<T>(items: T[], getContentKey: (item: T) => string) {
  const occurrences = new Map<string, number>();
  return items.map(item => {
    const contentKey = getContentKey(item);
    const occurrence = occurrences.get(contentKey) ?? 0;
    occurrences.set(contentKey, occurrence + 1);
    return { item, key: JSON.stringify([contentKey, occurrence]) };
  });
}

export default function AICustomBlueprint({ isOpen, onClose, onGenerated }: AICustomBlueprintProps) {
  const { dialogProps: overlayDialogProps, titleId: overlayTitleId } = useDialog(onClose, isOpen);
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<import("../../services/aiService").GeneratedBlueprint | null>(null);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error("Please describe your business first.");
      return;
    }

    setIsGenerating(true);
    try {
      let data = null;

      try {
        // Attempt AI generation
        const aiResult = await aiService.process('parse-business-blueprint', { description });
        if (aiResult && aiResult.name) {
          data = aiResult;
        }
      } catch (aiError) {
        console.warn("AI generation failed, falling back to deterministic matching:", aiError);
      }

      if (!data) {
        // Fallback deterministic logic
        const lowerDesc = description.toLowerCase();
        let bestMatch = BUSINESS_TEMPLATES['saas']; // default
        let maxScore = 0;

        for (const [key, template] of Object.entries(BUSINESS_TEMPLATES)) {
          let score = 0;
          const keywords = template.name.toLowerCase().split(' ').concat(template.description.toLowerCase().split(' '));
          keywords.forEach((kw: string) => {
            if (kw.length > 3 && lowerDesc.includes(kw)) score++;
          });
          
          // Add specific domain keywords
          if (key === 'retail' && (lowerDesc.includes('shop') || lowerDesc.includes('store') || lowerDesc.includes('physical'))) score += 5;
          if (key === 'creative' && (lowerDesc.includes('art') || lowerDesc.includes('design') || lowerDesc.includes('freelance'))) score += 5;
          if (key === 'realestate' && (lowerDesc.includes('property') || lowerDesc.includes('rent') || lowerDesc.includes('house'))) score += 5;
          if (key === 'saas' && (lowerDesc.includes('software') || lowerDesc.includes('tech') || lowerDesc.includes('app') || lowerDesc.includes('cloud'))) score += 5;
          if (key === 'agriculture' && (lowerDesc.includes('farm') || lowerDesc.includes('crop') || lowerDesc.includes('livestock') || lowerDesc.includes('organic') || lowerDesc.includes('agriculture') || lowerDesc.includes('feed'))) score += 8;
          if (key === 'healthcare' && (lowerDesc.includes('clinic') || lowerDesc.includes('medical') || lowerDesc.includes('doctor') || lowerDesc.includes('dentist') || lowerDesc.includes('patient') || lowerDesc.includes('hospital'))) score += 8;
          if (key === 'logistics' && (lowerDesc.includes('truck') || lowerDesc.includes('freight') || lowerDesc.includes('cargo') || lowerDesc.includes('fleet') || lowerDesc.includes('delivery') || lowerDesc.includes('logistics'))) score += 8;
          if (key === 'subscription_box' && (lowerDesc.includes('subscription') || lowerDesc.includes('box') || lowerDesc.includes('recurring') || lowerDesc.includes('kit') || lowerDesc.includes('curated'))) score += 8;
          if (key === 'construction' && (lowerDesc.includes('build') || lowerDesc.includes('construct') || lowerDesc.includes('contractor') || lowerDesc.includes('heavy equipment') || lowerDesc.includes('renovate'))) score += 8;
          if (key === 'automotive' && (lowerDesc.includes('mechanic') || lowerDesc.includes('car') || lowerDesc.includes('garage') || lowerDesc.includes('auto') || lowerDesc.includes('repair') || lowerDesc.includes('vehicle'))) score += 8;
          if (key === 'renewable_energy' && (lowerDesc.includes('solar') || lowerDesc.includes('energy') || lowerDesc.includes('green') || lowerDesc.includes('utility') || lowerDesc.includes('carbon'))) score += 8;
          if (key === 'import_export' && (lowerDesc.includes('import') || lowerDesc.includes('export') || lowerDesc.includes('trade') || lowerDesc.includes('ocean') || lowerDesc.includes('cargo') || lowerDesc.includes('wholesale'))) score += 8;
          if (key === 'franchise' && (lowerDesc.includes('franchise') || lowerDesc.includes('royalty') || lowerDesc.includes('brand') || lowerDesc.includes('outlet'))) score += 8;
          if (key === 'software_agency' && (lowerDesc.includes('agency') || lowerDesc.includes('dev') || lowerDesc.includes('consulting') || lowerDesc.includes('contractor') || lowerDesc.includes('milestone'))) score += 8;

          if (key === 'enterprise_saas' && (lowerDesc.includes('enterprise') || lowerDesc.includes('global') || lowerDesc.includes('multi-product') || lowerDesc.includes('b2b') || lowerDesc.includes('multi-region') || lowerDesc.includes('scale'))) score += 10;
          if (key === 'holding_company' && (lowerDesc.includes('holding') || lowerDesc.includes('conglomerate') || lowerDesc.includes('multi-entity') || lowerDesc.includes('subsidiary') || lowerDesc.includes('portfolio') || lowerDesc.includes('parent'))) score += 10;
          if (key === 'manufacturing_multi' && (lowerDesc.includes('multi-factory') || lowerDesc.includes('supply chain') || lowerDesc.includes('global distribution') || lowerDesc.includes('multi-site') || lowerDesc.includes('international'))) score += 10;
          if (key === 'private_equity' && (lowerDesc.includes('venture') || lowerDesc.includes('vc') || lowerDesc.includes('private equity') || lowerDesc.includes('pe') || lowerDesc.includes('fund') || lowerDesc.includes('capital call'))) score += 10;
          
          if (score > maxScore) {
            maxScore = score;
            bestMatch = template;
          }
        }

        data = {
          name: bestMatch.name,
          description: bestMatch.description,
          industry: bestMatch.name,
          strategicAdvice: ["Based on algorithmic matching, this is the optimal structure.", "Monitor your key expense categories.", "Review income channels periodically."],
          chartOfAccounts: bestMatch.accounts.map(a => ({
             category: a.category,
             code: a.code,
             name: a.name,
             type: a.type
          })),
          dashboardSchema: { nodes: bestMatch.topology.nodes, links: bestMatch.topology.links }
        };
      }

      setGeneratedData(data);
      toast.success("Blueprint mapped successfully!");
    } catch (error) {
      console.error("Mapping Error:", error);
      toast.error("Failed to map blueprint. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (generatedData) {
      onGenerated(generatedData);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <ModalShell dialogProps={overlayDialogProps} onClose={onClose} layer="z-[300]"
      panelClassName="w-full max-w-4xl bg-[var(--surface)] rounded-[40px] shadow-2xl border border-[var(--line)] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="p-4 md:p-10 border-b border-[var(--line)] flex items-center justify-between bg-[var(--ink)]/50">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 bg-orange-50 rounded-[32px] flex items-center justify-center text-orange-600 border border-orange-100">
              <Sparkles size={32} />
            </div>
            <div>
              <h2 id={overlayTitleId} className="text-2xl font-black text-[var(--text)] tracking-tight">Analytical Architect</h2>
              <p className="text-sm text-zinc-500">Describe your business model, and we'll architect the system structure.</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-3 hover:bg-zinc-100 rounded-full transition-colors"><X size={24} className="text-zinc-400" /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 md:p-10">
          {!generatedData ? (
            <div className="max-w-2xl mx-auto space-y-8 py-10">
              <div className="space-y-4">
                <Labelled labelClassName="block text-xs font-medium uppercase tracking-wider text-zinc-400" label="How does your business work?">
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., I run a boutique coffee shop that also sells beans online. I have 3 employees and rent a space in downtown..."
                    className="w-full h-48 px-8 py-6 bg-[var(--ink)] border-2 border-[var(--line)] rounded-[32px] focus:outline-none focus:border-orange-500 transition-all text-lg leading-relaxed resize-none"
                  />
                </Labelled>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] space-y-3">
                  <div className="w-10 h-10 bg-[var(--surface)] rounded-xl flex items-center justify-center text-[var(--text)] shadow-sm">
                    <BookOpen size={20} />
                  </div>
                  <h4 className="font-bold text-[var(--text)]">Custom COA</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    AI will generate a Chart of Accounts tailored to your specific industry and revenue streams.
                  </p>
                </div>
                <div className="p-6 bg-[var(--ink)] rounded-[32px] border border-[var(--line)] space-y-3">
                  <div className="w-10 h-10 bg-[var(--surface)] rounded-xl flex items-center justify-center text-[var(--text)] shadow-sm">
                    <Layout size={20} />
                  </div>
                  <h4 className="font-bold text-[var(--text)]">Visual Topology</h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    A custom dashboard schema will be built to visualize your unique money flow.
                  </p>
                </div>
              </div>

              <button 
                onClick={handleGenerate}
                disabled={isGenerating || !description.trim()}
                className={cn(
                  "w-full py-6 rounded-[32px] font-black text-lg flex items-center justify-center gap-3 transition-all shadow-xl shadow-orange-500/20",
                  isGenerating 
                    ? "bg-zinc-100 text-zinc-400 cursor-not-allowed" 
                    : "bg-orange-500 text-white hover:bg-orange-600"
                )}
               aria-label="Loader2 action">
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={24} />
                    Building Blueprint...
                  </>
                ) : (
                  <>
                    <Wand2 size={24} />
                    Generate Blueprint
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-10">
              <div className="p-4 md:p-8 bg-emerald-50 border border-emerald-100 rounded-[32px] flex items-center gap-6">
                <div className="w-16 h-16 bg-[var(--surface)] rounded-[32px] flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100">
                  <CheckCircle2 size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-emerald-900">{generatedData.name}</h3>
                  <p className="text-sm text-emerald-700">{generatedData.description}</p>
                </div>
              </div>

              {/* Strategic Advice Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {withStableKeys(generatedData.strategicAdvice ?? [], (advice: string) => advice).map(({ item: advice, key }, i) => (
                  <div key={key} className="p-6 bg-zinc-900 text-white rounded-[32px] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Sparkles size={40} />
                    </div>
                    <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-4 block">Strategy 0{i+1}</span>
                    <p className="text-sm font-medium leading-relaxed">{advice}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <h4 className="micro-label">Generated Chart of Accounts</h4>
                  <div className="bg-[var(--ink)] rounded-[32px] border border-[var(--line)] overflow-hidden">
                    <div className="divide-y divide-zinc-200">
                      {withStableKeys(showAllAccounts ? generatedData.chartOfAccounts : generatedData.chartOfAccounts.slice(0, 8), (acc) => JSON.stringify(
                        acc.id != null ? ['id', acc.id] : ['account', acc.code, acc.name, acc.type, acc.category]
                      )).map(({ item: acc, key }) => (
                        <div key={key} className="p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="mono-value !text-[10px] bg-[var(--surface)] px-2 py-1 rounded border border-[var(--line)]">{acc.code}</span>
                            <span className="text-sm font-bold text-[var(--text)]">{acc.name}</span>
                          </div>
                          <span className={cn(
                            "text-[10px] font-medium uppercase tracking-wider px-2 py-1 rounded-md",
                            acc.type === 'income' ? 'bg-emerald-100 text-emerald-700' :
                            acc.type === 'expense' ? 'bg-rose-100 text-rose-700' :
                            'bg-blue-100 text-blue-700'
                          )}>{acc.type}</span>
                        </div>
                      ))}
                      {generatedData.chartOfAccounts.length > 8 && (
                        <button 
                          onClick={() => setShowAllAccounts(!showAllAccounts)}
                          className="w-full p-4 text-center text-xs text-indigo-600 font-bold hover:underline cursor-pointer bg-[var(--surface)]/30"
                        >
                          {showAllAccounts ? 'Show Top 8 Accounts' : `+ ${generatedData.chartOfAccounts.length - 8} more accounts (Click to expand)`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <h4 className="micro-label">Dashboard Structure</h4>
                  <div className="bg-[var(--ink)] rounded-[32px] border border-[var(--line)] p-4 md:p-8 flex flex-col items-center justify-center text-center min-h-[300px]">
                    <div className="w-20 h-20 bg-[var(--surface)] rounded-[32px] flex items-center justify-center text-zinc-300 mb-6 border border-[var(--line)] shadow-sm">
                      <Layout size={40} />
                    </div>
                    <p className="text-sm font-bold text-[var(--text)] mb-2">Structure Ready</p>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      {generatedData.dashboardSchema.nodes!.length} nodes and {generatedData.dashboardSchema.links!.length} connections mapped to your business model.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setGeneratedData(null)}
                  className="px-10 py-5 bg-[var(--surface)] text-zinc-600 rounded-[32px] font-black border border-[var(--line)] hover:bg-[var(--ink)] transition-all"
                >
                  Start Over
                </button>
                <button 
                  onClick={handleApply}
                  className="flex-1 py-5 bg-zinc-900 text-white rounded-[32px] font-black hover:bg-zinc-800 transition-all shadow-xl shadow-zinc-900/20 flex items-center justify-center gap-2"
                 aria-label="Apply & Save Blueprint">
                  Apply & Save Blueprint
                  <ArrowRight size={20} />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 md:p-8 bg-[var(--ink)] border-t border-[var(--line)] flex items-center gap-4">
          <AlertCircle className="text-zinc-400" size={20} />
          <p className="text-xs text-zinc-500 font-medium">
            AI-generated blueprints are starting points. You can always customize accounts and dashboard nodes later.
          </p>
        </div>
    </ModalShell>
  );
}
