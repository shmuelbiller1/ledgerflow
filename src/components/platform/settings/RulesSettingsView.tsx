import { formatCurrency } from '../../../lib/utils';
import { SlidersHorizontal, Plus, Play, Trash2, Copy, CheckCircle2, AlertCircle, Filter, Tag, RotateCw, Search, Eye, Check, X, Sparkles } from 'lucide-react';
import InlineEdit from '../../ui/InlineEdit';
import { Labelled } from '../../ui/Labelled';
import { EmptyState } from '../../ui/EmptyState';
import type { RulesSettingsModel } from './RulesSettings';
import { inBackground } from '../../../lib/inBackground';

export function RulesSettingsView({ formError, draftActionPreview, formTargetAccountId, setFormTargetAccountId, formBankAccountId, setFormBankAccountId, formTransactionKind, setFormTransactionKind, chartAccounts, bankAccounts, applyError, canEditRules, disabledGroups, groupError, handleToggleGroup, handleRenameGroup, setRulePriority, isUpdatingGroup, formPriority, setFormPriority, withOccurrenceKeys, formId, currentRole, canBuildRules, autoRules, selectedGroup, setSelectedGroup, searchQuery, setSearchQuery, isCreatingRule, setIsCreatingRule, overlay2DialogProps, overlay2TitleId, editingRule, aiSentence, setAiSentence, isGeneratingAiRule, aiError, aiPreview, setAiPreview, dryRunResult, isTestingRule, setIsTestingRule, overlay1DialogProps, overlay1TitleId, isApplyingExisting, applySuccessMessage, setApplySuccessMessage, formName, setFormName, formGroup, setFormGroup, formDescContains, setFormDescContains, formVendor, setFormVendor, formCategory, setFormCategory, formAmountThreshold, setFormAmountThreshold, formTargetCategory, setFormTargetCategory, formTargetClass, setFormTargetClass, formTargetLocation, setFormTargetLocation, formAddTags, setFormAddTags, formFlagForReview, setFormFlagForReview, formStopOnMatch, setFormStopOnMatch, singleRuleTestResult, groups, filteredRules, handleToggleActive, handleDeleteRule, handleDuplicateRule, openCreateModal, openEditModal, handleSaveRule, handleTestSingleRule, handleGenerateAiRule, handleSaveAiRule, handleRunDryRun, handleApplyToExisting }: RulesSettingsModel) {
  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4 sm:p-6" id="rules-settings-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="w-5 h-5 text-neutral-700" />
            Rules & Automation Engine
          </h2>
          <p className="text-sm text-neutral-500 mt-1">
            Automate categorization, tagging, classification, and validation across all past and future transactions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRunDryRun}
            className="px-3.5 py-2 text-xs font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg flex items-center gap-1.5 transition-colors border border-neutral-300"
            id="test-all-rules-btn"
          >
            <Play aria-hidden="true" className="w-3.5 h-3.5 text-neutral-700" />
            Test Against Ledger
          </button>
          <button
            disabled={!canEditRules}
            onClick={openCreateModal}
            className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
            id="create-new-rule-btn"
          >
            <Plus aria-hidden="true" className="w-3.5 h-3.5" />
            Create Rule
          </button>
        </div>
      </div>

      {/* Describe a Rule (AI Rule Builder) */}
      <div className="bg-gradient-to-r from-neutral-900 to-neutral-800 text-white p-4 rounded-xl shadow-xs border border-neutral-700">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles aria-hidden="true" className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Describe a Rule in Plain English</h3>
        </div>
        <p className="text-xs text-neutral-300 mb-3">
          Type what you want to automate (e.g. &quot;Categorize any transaction containing AWS as Software & IT, and tag as Infrastructure&quot;).
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          {canBuildRules ? (
            <>
              <input aria-label="Describe the rule to create"
                type="text"
                value={aiSentence}
                onChange={(e) => setAiSentence(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') inBackground(handleGenerateAiRule()); }}
                placeholder="e.g. Set category to Marketing when vendor is Google Ads and amount is over $100..."
                className="flex-1 w-full bg-neutral-800/80 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-neutral-400 focus:outline-hidden focus:border-amber-400"
              />
              <button
                onClick={handleGenerateAiRule}
                disabled={isGeneratingAiRule || !aiSentence.trim()}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {isGeneratingAiRule ? <RotateCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" /> : <Sparkles aria-hidden="true" className="w-3.5 h-3.5" />}
                Generate Rule
              </button>
            </>
          ) : (
            <div className="flex-1 text-xs text-amber-300 bg-neutral-950/40 p-2.5 rounded-lg border border-amber-500/20 flex items-center gap-2">
              <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0 text-amber-400" />
              <span>AI Rule Builder is restricted to Owners and Accountants. Your current role is {currentRole}.</span>
            </div>
          )}
        </div>

        {aiError && (
          <div className="mt-3 p-2.5 bg-red-900/50 border border-red-700/50 rounded-md text-red-200 text-xs flex items-center gap-2">
            <AlertCircle aria-hidden="true" className="w-4 h-4 text-red-400 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}

        {aiPreview && (
          <div className="mt-4 p-4 bg-neutral-950/90 border border-neutral-700 rounded-lg text-xs space-y-3">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="font-semibold text-amber-400">AI Proposed Rule</span>
              <span className="text-neutral-400">
                Dry Run Match: <strong className="text-white" id="dryrun-summary-total-matched">{aiPreview.affectedCount}</strong> transaction(s) matched on ledger (dryRun.summary.totalMatched)
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-neutral-300 bg-neutral-900/60 p-3 rounded-md">
              <div>
                <strong className="text-neutral-400 block text-[10px] uppercase">Rule Name</strong>
                <span className="text-white font-medium">{aiPreview.rule.name}</span>
              </div>
              <div>
                <strong className="text-neutral-400 block text-[10px] uppercase">Condition</strong>
                <span>
                  {aiPreview.rule.condition.vendor && `Vendor: ${aiPreview.rule.condition.vendor} `}
                  {aiPreview.rule.condition.descriptionContains && `Contains: "${aiPreview.rule.condition.descriptionContains}" `}
                  {aiPreview.rule.condition.amountThreshold && `> $${aiPreview.rule.condition.amountThreshold}`}
                </span>
              </div>
              <div>
                <strong className="text-neutral-400 block text-[10px] uppercase">Action Target Category</strong>
                <span className="text-emerald-400">{aiPreview.rule.action.targetCategory || 'None'}</span>
              </div>
              <div>
                <strong className="text-neutral-400 block text-[10px] uppercase">Action Tags</strong>
                <span className="text-amber-300">{aiPreview.rule.action.addTags?.join(', ') || 'None'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setAiPreview(null)}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-md text-xs"
              >
                Discard
              </button>
              <button
                onClick={() => {
                  openEditModal(aiPreview.rule);
                  setAiPreview(null);
                }}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md text-xs"
              >
                Edit
              </button>
              <button
                onClick={() => handleSaveAiRule(false)}
                className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-white rounded-md text-xs font-medium"
              >
                Save (as Inactive)
              </button>
              <button
                onClick={() => handleSaveAiRule(true)}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-md text-xs font-semibold"
              >
                Save & Activate
              </button>
            </div>
          </div>
        )}
      </div>

      {applySuccessMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-emerald-600" />
            <span>{applySuccessMessage}</span>
          </div>
          <button onClick={() => setApplySuccessMessage(null)} aria-label="Dismiss rule results" className="text-emerald-700 hover:text-emerald-900">
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Group & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-neutral-50 p-3 rounded-lg border border-neutral-200">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setSelectedGroup(null)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              selectedGroup === null
                ? 'bg-white text-neutral-900 shadow-xs border border-neutral-300'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            All Rules ({autoRules.length})
          </button>
          {groups.map(group => (
            <button
              key={group}
              onClick={() => setSelectedGroup(group)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                selectedGroup === group
                  ? 'bg-white text-neutral-900 shadow-xs border border-neutral-300'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {group}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search aria-hidden="true" className="w-3.5 h-3.5 absolute left-3 top-2.5 text-neutral-400" />
          <input aria-label="Search rules"
            type="text"
            placeholder="Search rules..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-neutral-200 rounded-md bg-white focus:outline-hidden focus:ring-1 focus:ring-neutral-400"
          />
        </div>
      </div>

      <section aria-label="Rule groups" className="space-y-2">
        <p className="text-xs text-neutral-600">Group off pauses its rules without changing their individual switches. Lower priority runs first, including across groups. This preview uses the transactions loaded in this workspace.</p>
        {groupError && <p role="alert" className="text-sm text-red-700">{groupError}</p>}
        <div className="flex flex-wrap gap-3">
          {groups.map(group => (
            <div key={group} className="flex items-center gap-2 min-w-0 max-w-full rounded-lg border border-neutral-200 px-3">
              <InlineEdit label={`Name of group ${group}`} value={group} canEdit={canEditRules && !isUpdatingGroup}
                suggestions={groups} onSave={next => handleRenameGroup(group, next)} className="min-h-11 break-all" inputClassName="min-h-11"
                validate={next => String(next).trim().length > 0 && String(next).trim().length <= 120 ? null : 'Enter a group name of 1–120 characters.'} />
              <button type="button" aria-label={`Enable group ${group}`} aria-pressed={!disabledGroups.has(group)}
                disabled={!canEditRules || isUpdatingGroup} onClick={() => void handleToggleGroup(group)}
                className="min-h-11 min-w-11 px-3 text-xs border-l border-neutral-200 disabled:opacity-50">
                {disabledGroups.has(group) ? 'Off' : 'On'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Rules Table */}
      {filteredRules.length === 0 ? (
        <EmptyState
          title={autoRules.length === 0 ? 'No automation rules yet' : 'No rules match the search'}
          description="A rule matches incoming bank lines on your words and files them — assigns the account, the contact and the labels — so the bank feed needs less handling."
          actionLabel={autoRules.length === 0 && canEditRules ? 'Add your first rule' : undefined}
          onAction={autoRules.length === 0 && canEditRules ? openCreateModal : undefined}
        />
      ) : (
        <div role="region" aria-label="Automation rules table" tabIndex={0} className="bg-white border border-neutral-200 rounded-lg overflow-x-auto shadow-xs">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Automation rules</caption>
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-semibold uppercase tracking-wider">
              <tr>
                <th scope="col" className="py-2.5 px-3 w-16">Active</th>
                <th scope="col" className="py-2.5 px-3">Rule Name & Group</th>
                <th scope="col" className="py-2.5 px-3">When Transaction Matches</th>
                <th scope="col" className="py-2.5 px-3">Actions Applied</th>
                <th scope="col" className="py-2.5 px-3 text-center">Hits</th>
                <th scope="col" className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredRules.map((rule) => {
                const isActive = rule.isActive !== false;
                return (
                  <tr key={rule.id} className={`hover:bg-neutral-50/80 transition-colors ${!isActive ? 'opacity-50' : ''}`}>
                    <td className="py-3 px-3">
                      <input aria-label={`Enable rule ${rule.name}`}
                        type="checkbox"
                        checked={isActive}
                        disabled={!canEditRules}
                        onChange={() => handleToggleActive(rule.id)}
                        className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-500 h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-neutral-900">{rule.name || rule.id}</div>
                      <div className="text-[11px] text-neutral-500 flex items-center gap-2 mt-0.5">
                        <span className="bg-neutral-100 px-1.5 py-0.5 rounded-sm border border-neutral-200">
                          {rule.groupName || 'General'}
                        </span>
                        <InlineEdit label={`Priority of ${rule.name || rule.id}`} value={rule.priority ?? 100} kind="number"
                          display={`Priority #${rule.priority ?? 100}`} canEdit={canEditRules} className="min-h-11" inputClassName="min-h-11"
                          validate={next => Number.isSafeInteger(Number(next)) ? null : 'Enter a whole-number priority.'}
                          onSave={next => setRulePriority(rule.id, Number(next))} />
                        {disabledGroups.has(rule.groupName || 'General') && <span>Group paused</span>}
                        {rule.stopProcessingOnMatch && (
                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-sm">Stop on match</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-neutral-700 space-y-0.5">
                      {rule.condition.descriptionContains && (
                        <div>Desc contains: <span className="font-semibold text-neutral-900">"{rule.condition.descriptionContains}"</span></div>
                      )}
                      {rule.condition.vendor && (
                        <div>Vendor: <span className="font-semibold text-neutral-900">"{rule.condition.vendor}"</span></div>
                      )}
                      {rule.condition.category && (
                        <div>Category: <span className="font-semibold text-neutral-900">{rule.condition.category}</span></div>
                      )}
                      {rule.condition.amountThreshold && (
                        <div>Amount &ge; <span className="font-semibold text-neutral-900">${rule.condition.amountThreshold}</span></div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-neutral-700 space-y-0.5">
                      {rule.action.targetAccountId && <div>Counterparty: {chartAccounts.find(account => account.id === rule.action.targetAccountId)?.name || 'Account no longer available'}</div>}
                      {rule.action.targetTransactionKind && <div>Classification: {rule.action.targetTransactionKind}</div>}
                      {rule.action.targetCategory && (
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-500">Categorize:</span>
                          <span className="font-medium text-neutral-900 bg-neutral-100 px-1.5 py-0.2 rounded-sm border border-neutral-200">
                            {rule.action.targetCategory}
                          </span>
                        </div>
                      )}
                      {rule.action.targetClass && (
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-500">Class:</span>
                          <span className="font-medium text-neutral-900">{rule.action.targetClass}</span>
                        </div>
                      )}
                      {rule.action.targetLocation && (
                        <div className="flex items-center gap-1">
                          <span className="text-neutral-500">Location:</span>
                          <span className="font-medium text-neutral-900">{rule.action.targetLocation}</span>
                        </div>
                      )}
                      {rule.action.addTags && rule.action.addTags.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Tag aria-hidden="true" className="w-3 h-3 text-neutral-400" />
                          <span>{rule.action.addTags.join(', ')}</span>
                        </div>
                      )}
                      {rule.action.flagForReview && (
                        <div className="text-amber-700 font-medium">Flag for review</div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-neutral-100 text-neutral-700 rounded-full">
                        {rule.hitCount || 0}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-1">
                      <button
                        disabled={!canEditRules}
                          onClick={() => openEditModal(rule)}
                        className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
                        title="Edit Rule"
                        aria-label={`Edit rule ${rule.name}`}
                      >
                        <Eye aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={!canEditRules}
                          onClick={() => handleDuplicateRule(rule)}
                        className="p-1.5 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-md transition-colors"
                        title="Duplicate Rule"
                        aria-label={`Duplicate rule ${rule.name}`}
                      >
                        <Copy aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                      <button
                        disabled={!canEditRules}
                          onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md transition-colors"
                        title="Delete Rule"
                        aria-label={`Delete rule ${rule.name}`}
                      >
                        <Trash2 aria-hidden="true" className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Dry Run / Test Results Modal */}
      {isTestingRule && dryRunResult && (
        <div {...overlay1DialogProps} className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-neutral-200">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <div>
                <h3 id={overlay1TitleId} className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <Play aria-hidden="true" className="w-4 h-4 text-emerald-600" />
                  Ledger Rules Dry-Run Simulation
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Scanned {dryRunResult.summary.totalScanned} transactions. Found {dryRunResult.summary.totalMatched} matches ready to update.
                </p>
              </div>
              <button onClick={() => setIsTestingRule(false)} aria-label="Close rule test results" className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md">
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {applyError && <p role="alert" className="text-sm text-red-700">{applyError}</p>}
              {dryRunResult.errors.map(error => <p role="alert" key={JSON.stringify([error.transactionId, error.ruleId])} className="text-sm text-red-700">Entry {error.transactionId}: {error.message}</p>)}
              {dryRunResult.matches.length === 0 ? (
                <div className="text-center py-10 text-neutral-500 text-xs">
                  No existing transactions matched any active rule conditions.
                </div>
              ) : (
                <div className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
                  {dryRunResult.matches.slice(0, 50).map(match => (
                    <div key={JSON.stringify([match.transactionId, match.matchedRule.id])} className="p-3 bg-white text-xs hover:bg-neutral-50 flex items-start justify-between gap-4">
                      <div>
                        <div className="font-semibold text-neutral-900">
                          {match.txOriginal.date} — {match.txOriginal.description} ({formatCurrency(match.txOriginal.totalAmountCents)})
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          Matched rule: <span className="font-medium text-neutral-800">"{match.matchedRule.name || match.matchedRule.id}"</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {withOccurrenceKeys(match.changes, change => change).map(({ item: c, key }) => (
                            <span key={key} className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded-sm text-[10px] font-medium">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-neutral-400">
                        TX ID: {match.transactionId.slice(0, 8)}...
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <button
                onClick={() => setIsTestingRule(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                Close Preview
              </button>
              <button
                onClick={handleApplyToExisting}
                disabled={!canEditRules || isApplyingExisting || dryRunResult.errors.length > 0 || dryRunResult.matches.length === 0}
                className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors disabled:opacity-50"
              >
                {isApplyingExisting ? (
                  <>
                    <RotateCw aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
                    Applying Rules...
                  </>
                ) : (
                  <>
                    <Check aria-hidden="true" className="w-3.5 h-3.5" />
                    Apply {dryRunResult.matches.length} Updates to Ledger
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Rule Modal */}
      {isCreatingRule && (
        <div {...overlay2DialogProps} className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-neutral-200">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50">
              <h3 id={overlay2TitleId} className="text-base font-bold text-neutral-900">
                {editingRule ? 'Edit Automation Rule' : 'Create Automation Rule'}
              </h3>
              <button onClick={() => setIsCreatingRule(false)} aria-label="Close rule editor" className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-md">
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              {formError && <p role="alert" className="text-red-700">{formError}</p>}
              {draftActionPreview && <div aria-label="Draft action preview">
                {draftActionPreview.errors.map(error => <p role="alert" className="text-red-700" key={error.transactionId}>{error.transactionId}: {error.message}</p>)}
                {draftActionPreview.matches.map(match => <p key={match.transactionId}>{match.txOriginal.description}: {match.changes.join('; ')}</p>)}
              </div>}
              {/* Basic Info */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Rule Name">
                    <input
                      type="text"
                      placeholder="e.g. AWS Cloud Services"
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      className="w-full p-2 border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    />
                  </Labelled>
                </div>
                <div>
                  <Labelled labelClassName="block font-semibold text-neutral-700 mb-1" label="Rule Group">
                    <input
                      type="text"
                      placeholder="General / SaaS / Vendors"
                      list={`${formId}-groups`}
                      value={formGroup}
                      onChange={e => setFormGroup(e.target.value)}
                      className="w-full p-2 border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                    />
                  </Labelled>
                </div>
              </div>

              <datalist id={`${formId}-groups`}>{groups.map(group => <option key={group} value={group} />)}</datalist>
              <Labelled label="Priority (lower runs first)">
                <input type="number" value={formPriority} step="1" className="min-h-11 w-full p-2 border border-neutral-300 rounded-md"
                  onChange={event => setFormPriority(event.target.value)} />
              </Labelled>

              {/* Conditions */}
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-3">
                <div className="font-bold text-neutral-800 flex items-center gap-1.5">
                  <Filter aria-hidden="true" className="w-3.5 h-3.5 text-neutral-600" />
                  IF Transaction Matches (Conditions)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Description contains">
                      <input
                        type="text"
                        placeholder="e.g. AMZN, GSUITE, UBER"
                        value={formDescContains}
                        onChange={e => setFormDescContains(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Vendor / Payee">
                      <input
                        type="text"
                        placeholder="e.g. Amazon Web Services"
                        value={formVendor}
                        onChange={e => setFormVendor(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Current Category / Account">
                      <input
                        type="text"
                        placeholder="e.g. Uncategorized"
                        value={formCategory}
                        onChange={e => setFormCategory(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Amount &ge; ($ threshold)">
                      <input
                        type="number"
                        placeholder="e.g. 500"
                        value={formAmountThreshold}
                        onChange={e => setFormAmountThreshold(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200 space-y-3">
                <div className="font-bold text-neutral-800 flex items-center gap-1.5">
                  <CheckCircle2 aria-hidden="true" className="w-3.5 h-3.5 text-neutral-600" />
                  THEN Apply Actions
                </div>
                <p className="text-xs text-neutral-600">Account/type actions preserve the bank side and amounts. Use a separate rule and apply its group separately from tagging. Only standalone two-line entries without tax or splits are supported.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Labelled label="Counterparty account (existing chart)">
                    <select className="min-h-11 w-full min-w-0 border border-neutral-300 rounded-md p-2" value={formTargetAccountId} onChange={event => setFormTargetAccountId(event.target.value)}>
                      <option value="">Keep current account</option>
                      {chartAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                    </select>
                  </Labelled>
                  <Labelled label="Bank account to preserve">
                    <select className="min-h-11 w-full min-w-0 border border-neutral-300 rounded-md p-2" value={formBankAccountId} onChange={event => setFormBankAccountId(event.target.value)}>
                      <option value="">Detect the only bank/cash line</option>
                      {bankAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                    </select>
                  </Labelled>
                  <Labelled label="Expense / transfer classification">
                    <select className="min-h-11 w-full min-w-0 border border-neutral-300 rounded-md p-2" value={formTransactionKind} onChange={event => setFormTransactionKind(event.target.value as '' | 'expense' | 'transfer')}>
                      <option value="">Follow the selected account</option><option value="expense">Expense (expense/COGS account)</option><option value="transfer">Transfer (bank/cash account)</option>
                    </select>
                  </Labelled>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Assign Category">
                      <input
                        type="text"
                        placeholder="e.g. Software & Subscriptions"
                        value={formTargetCategory}
                        onChange={e => setFormTargetCategory(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Add Tags (comma-separated)">
                      <input
                        type="text"
                        placeholder="e.g. saas, dev-tools, recurring"
                        value={formAddTags}
                        onChange={e => setFormAddTags(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Assign Class Dimension">
                      <input
                        type="text"
                        placeholder="e.g. Engineering, Sales, Ops"
                        value={formTargetClass}
                        onChange={e => setFormTargetClass(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                  <div>
                    <Labelled labelClassName="block text-neutral-600 mb-1" label="Assign Location Dimension">
                      <input
                        type="text"
                        placeholder="e.g. HQ - New York"
                        value={formTargetLocation}
                        onChange={e => setFormTargetLocation(e.target.value)}
                        className="w-full p-2 bg-white border border-neutral-300 rounded-md focus:ring-1 focus:ring-neutral-500 focus:outline-hidden"
                      />
                    </Labelled>
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center gap-4">
                  <label htmlFor={`${formId}-review`} className="flex items-center gap-2 cursor-pointer">
                    <input
                      id={`${formId}-review`}
                      type="checkbox"
                      checked={formFlagForReview}
                      onChange={e => setFormFlagForReview(e.target.checked)}
                      className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-500 h-4 w-4"
                    />
                    <span className="text-neutral-700">Flag for manual review</span>
                  </label>
                  <label htmlFor={`${formId}-stop`} className="flex items-center gap-2 cursor-pointer">
                    <input
                      id={`${formId}-stop`}
                      type="checkbox"
                      checked={formStopOnMatch}
                      onChange={e => setFormStopOnMatch(e.target.checked)}
                      className="rounded-sm border-neutral-300 text-neutral-900 focus:ring-neutral-500 h-4 w-4"
                    />
                    <span className="text-neutral-700">Stop processing lower-priority rules on match</span>
                  </label>
                </div>
              </div>

              {/* Test Rule Before Saving */}
              <div className="p-3 bg-neutral-50 rounded-lg border border-neutral-200">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-800">Test Rule Against Historical Ledger</span>
                  <button
                    onClick={handleTestSingleRule}
                    type="button"
                    className="px-3 py-1.5 text-xs font-semibold bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-md transition-colors"
                  >
                    Run Test Check
                  </button>
                </div>
                {singleRuleTestResult !== null && (
                  <div className="mt-2 text-xs">
                    {singleRuleTestResult.length === 0 ? (
                      <p className="text-neutral-500 italic">No existing transactions match these conditions.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-emerald-700 font-semibold">
                          Matches {singleRuleTestResult.length} historical transaction{singleRuleTestResult.length > 1 ? 's' : ''}:
                        </p>
                        <div className="max-h-32 overflow-y-auto space-y-1 bg-white p-2 rounded-sm border border-neutral-200">
                          {singleRuleTestResult.slice(0, 5).map(tx => (
                            <div key={tx.id} className="text-[11px] text-neutral-600 truncate">
                              {tx.date} — {tx.description} ({formatCurrency(tx.totalAmountCents)})
                            </div>
                          ))}
                          {singleRuleTestResult.length > 5 && (
                            <div className="text-[10px] text-neutral-400">...and {singleRuleTestResult.length - 5} more</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-between">
              <button
                onClick={() => setIsCreatingRule(false)}
                className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!canEditRules || isUpdatingGroup || !formPriority.trim() || !Number.isSafeInteger(Number(formPriority))}
                onClick={handleSaveRule}
                className="px-4 py-2 text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg flex items-center gap-1.5 shadow-sm transition-colors"
              >
                <Check aria-hidden="true" className="w-3.5 h-3.5" />
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
