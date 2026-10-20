import UsAddressHelp from './UsAddressHelp';
import TaxIdentifierHelp from './TaxIdentifierHelp';
import VatNumberHelp from './VatNumberHelp';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useLedgerStore } from '../../../stores/useLedgerStore';
import { useCurrentRole } from '../../../hooks/useCurrentRole';
import { getIdToken, db } from '../../../firebase';
import { doc, getDoc } from '../../../lib/db/firestore';
import { resolveSellerProfile, taxProfilesProblem, type TaxProfile, type TaxProfiles, type TaxRegistration } from '../../../lib/tax/profile';
import { validCustomReportPeriod } from '../../../lib/reportCustomPeriod';

const field = 'min-h-11 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2';
const kinds: TaxRegistration['kind'][] = ['vat','sales_tax','employer','income_tax','withholding'];
const frequencies = ['monthly','bimonthly','quarterly','yearly'] as const;
export default function TaxProfilesSettings() {
  const uid = useAuthStore(state=>state.user?.uid), workspaceId = useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedTaxProfiles key={JSON.stringify([uid,workspaceId])} />;
}
function ScopedTaxProfiles() {
  const workspace = useAuthStore(state=>state.getCurrentWorkspace()), uid = useAuthStore(state=>state.user?.uid);
  const nodes = useLedgerStore(state=>state.dimensionNodes), truncated = useLedgerStore(state=>state.truncatedCollections.dimensionNodes);
  const role = useCurrentRole(), isGuest = useAuthStore(state=>state.isGuest), canEdit = !isGuest && (role==='owner'||role==='accountant');
  const profiles = workspace?.taxProfiles || {};
  const [target,setTarget] = useState('books'), [editing,setEditing] = useState<{ target: string; original: TaxProfile | undefined; draft: TaxProfile; rowKeys: string[] } | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [newLabel,setNewLabel] = useState('');
  const pending=useRef(false), mounted=useRef(true);
  const registrationInputs=useRef(new Map<string,HTMLInputElement>()), addRegistration=useRef<HTMLButtonElement>(null);
  const editButton=useRef<HTMLButtonElement>(null), draftName=useRef<HTMLInputElement>(null), previouslyEditing=useRef(false);
  useEffect(()=>{
    if(editing&&!previouslyEditing.current)draftName.current?.focus();
    if(!editing&&previouslyEditing.current)editButton.current?.focus();
    previouslyEditing.current=Boolean(editing);
  },[editing]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const current=()=>mounted.current&&useAuthStore.getState().currentWorkspaceId===workspace?.id&&useAuthStore.getState().user?.uid===uid;
  const own=(key:string,value:TaxProfiles=profiles)=>key==='books'?value.books:value.labels?.[key];
  const names=new Map(nodes.map(node=>[`${node.dimensionId}:${node.id}`,node.description]));
  const targets=[...new Set(['books',...(editing?[editing.target]:[]),...Object.keys(profiles.labels||{}),...names.keys()])];
  const resolved=(key:string)=>key==='books'?resolveSellerProfile(profiles,{},[]):resolveSellerProfile(profiles,{[key.slice(0,key.indexOf(':'))]:key.slice(key.indexOf(':')+1)},[key.slice(0,key.indexOf(':'))]);
  function edit(key:string){if(!canEdit||busy)return;setTarget(key);setError('');setNotice('');const draft=structuredClone(own(key)||{});setEditing({target:key,original:structuredClone(own(key)),draft,rowKeys:(draft.registrations||[]).map(()=>crypto.randomUUID())});}
  function change(next:TaxProfile){if(editing&&!busy)setEditing({...editing,draft:next});}
  function removeRegistration(index:number){
    if(!editing||busy)return;
    const rowKeys=editing.rowKeys.filter((_,i)=>i!==index);
    const nextKey=rowKeys[Math.min(index,rowKeys.length-1)];
    setEditing({...editing,draft:{...editing.draft,registrations:editing.draft.registrations!.filter((_,i)=>i!==index)},rowKeys});
    queueMicrotask(()=>{if(current())(registrationInputs.current.get(nextKey)||addRegistration.current)?.focus();});
  }
  async function save() {
    if(!workspace||!uid||!editing||pending.current||!canEdit||!current())return;
    const submitted=structuredClone(editing);
    const dates=submitted.draft.registrations||[];
    if(dates.some(reg=>[reg.validFrom,reg.validTo].some(date=>date&&!validCustomReportPeriod({startDate:date,endDate:date})))){setError('Registration dates must be real calendar days.');return;}
    const candidate=submitted.target==='books'?{books:submitted.draft}:{labels:{[submitted.target]:submitted.draft}};
    const problem=taxProfilesProblem(candidate);if(problem){setError(problem);return;}
    pending.current=true;setBusy(true);setError('');
    try{
      // Refresh and preserve unrelated profiles instead of submitting an old whole-workspace cache.
      const fresh=await getDoc(doc(db,'workspaces',workspace.id));
      if(!current())return;
      if(!fresh.exists())throw new Error('This workspace is no longer available.');
      const data=fresh.data(), latest=(data.taxProfiles||{}) as TaxProfiles;
      const currentRole=data.uid===uid?'owner':data.roles?.[uid];
      if(currentRole!=='owner'&&currentRole!=='accountant')throw new Error('Only owners and accountants can edit tax profiles.');
      if(taxProfilesProblem(latest))throw new Error('The current tax profiles are not readable. Reload before editing.');
      if(JSON.stringify(own(submitted.target,latest))!==JSON.stringify(submitted.original))throw new Error('This profile changed while you were editing. Your draft is retained; cancel and reopen it to review the newer version.');
      const next:TaxProfiles=submitted.target==='books'?{...latest,books:submitted.draft}:{...latest,labels:{...latest.labels,[submitted.target]:submitted.draft}};
      const token=await getIdToken();if(!current())return;
      if(!token)throw new Error('Sign in again before saving this profile.');
      const active=useAuthStore.getState(), activeWorkspace=active.getCurrentWorkspace();
      const activeRole=activeWorkspace?.uid===uid?'owner':activeWorkspace?.roles?.[uid];
      if(active.isGuest||(activeRole!=='owner'&&activeRole!=='accountant'))throw new Error('Your permissions changed. The draft is retained; reopen this workspace before saving.');
      const res=await fetch(`/api/v1/workspaces/${encodeURIComponent(workspace.id)}/tax-profiles`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({profiles:next})});
      const result=await res.json().catch(()=>({}));if(!current())return;
      if(!res.ok)throw new Error(result.message||result.error||'The tax profile was not saved.');
      if(result.status!=='success'||taxProfilesProblem(result.profiles))throw new Error('The server did not confirm valid tax profiles. Reload to check the saved state.');
      const auth=useAuthStore.getState();auth.setWorkspaces(auth.workspaces.map(row=>row.id===workspace.id?{...row,taxProfiles:result.profiles}:row));
      setEditing(null);setNotice('Tax profile saved.');
    }catch(reason){if(current())setError(reason instanceof Error?reason.message:'The tax profile was not saved.');}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  if(!workspace)return <p>No workspace is selected.</p>;
  const unreadable=taxProfilesProblem(profiles);
  if(unreadable)return <section aria-label="Tax profiles" className="p-4"><h2>Tax profiles</h2><p role="alert">The saved tax profiles cannot be displayed safely: {unreadable}. Reload the workspace or ask an accountant to review them.</p></section>;
  const selected=resolved(target);
  const addLabel=()=>{const key=newLabel.trim(),problem=taxProfilesProblem({labels:{[key]:{}}});if(problem){setError(problem);return;}edit(key);};
  return <section aria-label="Tax profiles" className="space-y-4 p-4 min-w-0"><h2>Tax profiles</h2><p>Country, place and registrations for these books and their label values. Grey inherited values come from the nearest parent, then the books. These are declarations used for calculation; saving a profile does not verify a registration or make a filing ready.</p>
    {truncated&&<p role="status">The loaded label catalogue is incomplete. Existing profiles are listed; enter an exact label:value key to edit another.</p>}
    <label className="block">Profile<select className={field} value={target} disabled={Boolean(editing)} onChange={event=>setTarget(event.target.value)}>{targets.map(key=><option key={key} value={key}>{key==='books'?'The books':`${names.get(key)||key} (${key})`}</option>)}</select></label>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">{([
      ['Name',selected.name,'name'], ['Accounting basis',selected.basis,'basis'],
      ['Advance income-tax rate (מקדמות)',selected.advanceTaxRatePercent!==undefined?`${selected.advanceTaxRatePercent}%`:undefined,'advanceTaxRatePercent'],
      ['Advance income-tax frequency',selected.advanceTaxFrequency?(selected.advanceTaxFrequency==='bimonthly'?'Bi-monthly':'Monthly'):undefined,'advanceTaxFrequency'],
      ...(['country','state','city','county','district','postalCode'] as const).map(key=>[key==='postalCode'?'Postal code':key[0].toUpperCase()+key.slice(1),selected.place?.[key],`place.${key}`]),
      ['Registrations',(selected.registrations||[]).map(reg=>`${reg.kind.replaceAll('_',' ')}: ${reg.number} (${reg.place.country}${reg.place.state?` / ${reg.place.state}`:''}${reg.place.city?` / ${reg.place.city}`:''}; ${reg.filing||'frequency not set'}; ${reg.validFrom||'no start'} – ${reg.validTo||'no end'})`).join('; '),'registrations'],
    ] as Array<[string,string|undefined,string]>).map(([label,value,key])=>{
      const source=selected.from.find(parent=>{
        const profile=own(parent); if(!profile)return false;
        if(key.startsWith('place.')) return Boolean(profile.place?.[key.slice(6) as keyof NonNullable<TaxProfile['place']>]);
        if(key==='advanceTaxRatePercent') return profile.advanceTaxRatePercent!==undefined;
        if(key==='advanceTaxFrequency') return Boolean(profile.advanceTaxFrequency);
        return key==='registrations'?Boolean(profile.registrations?.length):Boolean(profile[key as 'name'|'basis']);
      });
      const inherited=Boolean(value&&source&&source!==target);
      return <div key={key}><dt className="font-semibold">{label}</dt><dd className={inherited?'min-w-0 break-words text-[var(--muted)]':'min-w-0 break-words'}><bdi dir="auto">{value||'Not set'}</bdi>{inherited&&<span className="block text-xs">Inherited from <bdi>{source==='books'?'the books':source}</bdi></span>}</dd></div>;
    })}</dl>
    {!editing&&canEdit&&<button ref={editButton} type="button" onClick={()=>edit(target)} className="min-h-11 border rounded px-3">Edit this profile</button>}
    {!editing&&canEdit&&<div className="flex flex-wrap gap-2"><label className="min-w-0">Another label:value key<input value={newLabel} onChange={event=>setNewLabel(event.target.value)} placeholder="world:entity/name" className={field}/></label><button type="button" onClick={addLabel} className="min-h-11 border rounded px-3">Edit label profile</button></div>}
    {editing&&<form onSubmit={event=>{event.preventDefault();void save();}} aria-label="Edit tax profile" className="rounded border p-3 space-y-3"><p><bdi>{editing.target}</bdi> — leave a field empty to inherit it. Registrations inherit as a whole when no own rows are supplied. If you set a place, its country is required; clear every place field to inherit the whole place.</p><fieldset disabled={busy||!canEdit} className="space-y-3"><legend className="sr-only">Own profile fields</legend>
      <label className="block">Profile name<input ref={draftName} className={field} value={editing.draft.name||''} maxLength={120} onChange={event=>change({...editing.draft,name:event.target.value||undefined})}/></label>
      <label className="block">Accounting basis<select className={field} value={editing.draft.basis||''} onChange={event=>change({...editing.draft,basis:(event.target.value||undefined) as TaxProfile['basis']})}><option value="">Inherit</option><option value="accrual">Accrual</option><option value="cash">Cash</option></select></label>
      <label className="block">Advance income-tax rate (מקדמות %)<input type="number" step="0.01" min="0" max="100" className={field} value={editing.draft.advanceTaxRatePercent!==undefined?String(editing.draft.advanceTaxRatePercent):''} placeholder="e.g. 3.5" onChange={event=>{const val=event.target.value.trim();change({...editing.draft,advanceTaxRatePercent:val===''?undefined:Number(val)});}}/></label>
      <label className="block">Advance income-tax frequency<select className={field} value={editing.draft.advanceTaxFrequency||''} onChange={event=>change({...editing.draft,advanceTaxFrequency:(event.target.value||undefined) as TaxProfile['advanceTaxFrequency']})}><option value="">Inherit</option><option value="monthly">Monthly</option><option value="bimonthly">Bi-monthly</option></select></label>
      {(['country','state','city','county','district','postalCode'] as const).map(key=><label key={key} className="block">{key==='postalCode'?'Postal code':key[0].toUpperCase()+key.slice(1)}<input className={field} value={editing.draft.place?.[key]||''} onChange={event=>{const next={...editing.draft.place,country:editing.draft.place?.country||'',[key]:key==='country'?event.target.value:event.target.value||undefined};change({...editing.draft,place:Object.values(next).some(Boolean)?next:undefined});}}/></label>)}
      {editing.draft.place?.country.trim().toUpperCase()==='US'&&<UsAddressHelp onUse={value=>change({...editing.draft,place:{...editing.draft.place!,...value}})}/>}
      <h3>Own registrations</h3>{(editing.draft.registrations||[]).map((reg,index)=>{const rowKey=editing.rowKeys[index];return <RegistrationFields key={rowKey} inputRef={element=>{const key=rowKey;if(element)registrationInputs.current.set(key,element);else registrationInputs.current.delete(key);}} value={reg} index={index} change={next=>change({...editing.draft,registrations:editing.draft.registrations!.map((row,i)=>i===index?next:row)})} remove={()=>removeRegistration(index)}/>;})}
      <button ref={addRegistration} type="button" disabled={(editing.draft.registrations?.length||0)>=30} onClick={()=>setEditing({...editing,draft:{...editing.draft,registrations:[...(editing.draft.registrations||[]),{kind:'vat',number:'',place:{country:''}}]},rowKeys:[...editing.rowKeys,crypto.randomUUID()]})} className="min-h-11 border rounded px-3">Add registration</button>
      <button type="submit" className="min-h-11 border rounded px-3">{busy?'Saving…':'Save profile'}</button></fieldset><button type="button" disabled={busy} onClick={()=>{setEditing(null);setError('');}} className="min-h-11 border rounded px-3">Cancel</button></form>}
    {error&&<p role="alert">{error}</p>}<p role="status">{notice}</p>

  </section>;
}
function RegistrationFields({value,index,change,remove,inputRef}:{inputRef:(element:HTMLInputElement|null)=>void;value:TaxRegistration;index:number;change:(next:TaxRegistration)=>void;remove:()=>void}){
  return <fieldset aria-label={`Registration ${index+1}`} className="rounded border p-2 space-y-2"><legend>Registration {index+1}</legend><label className="block">Registration kind<select className={field} value={value.kind} onChange={event=>change({...value,kind:event.target.value as TaxRegistration['kind']})}>{kinds.map(kind=><option key={kind} value={kind}>{kind.replaceAll('_',' ')}</option>)}</select></label><label className="block">Registration number<input ref={inputRef} className={field} value={value.number} maxLength={40} onChange={event=>change({...value,number:event.target.value})}/></label><TaxIdentifierHelp value={value.number}/>{value.kind==='vat'&&<VatNumberHelp value={value.number} country={value.place.country}/>}{(['country','state','city'] as const).map(key=><label key={key} className="block">Registration {key}<input className={field} value={value.place[key]||''} onChange={event=>change({...value,place:{...value.place,[key]:key==='country'?event.target.value:event.target.value||undefined}})}/></label>)}<label className="block">Filing frequency<select className={field} value={value.filing||''} onChange={event=>change({...value,filing:(event.target.value||undefined) as TaxRegistration['filing']})}><option value="">Not set</option>{frequencies.map(frequency=><option key={frequency} value={frequency}>{frequency}</option>)}</select></label>{(['validFrom','validTo'] as const).map(key=><label key={key} className="block">{key==='validFrom'?'Registration valid from':'Registration valid to'}<input type="date" className={field} value={value[key]||''} onChange={event=>change({...value,[key]:event.target.value||undefined})}/></label>)}<button type="button" onClick={remove} className="min-h-11 border rounded px-3">Remove registration {index+1}</button></fieldset>;
}
