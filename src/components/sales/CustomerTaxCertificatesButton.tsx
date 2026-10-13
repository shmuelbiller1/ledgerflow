import { lazy,Suspense,useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../../hooks/useDialog';
import { useAuthStore } from '../../stores/useAuthStore';
const Certificates=lazy(()=>import('../reporting/CustomerTaxCertificatesView'));

/** Keeps the customer's detail page mounted while reviewing the complete certificate list. */
export default function CustomerTaxCertificatesButton(){
  const uid=useAuthStore(state=>state.user?.uid),workspace=useAuthStore(state=>state.currentWorkspaceId);
  return <ScopedButton key={JSON.stringify([uid,workspace])}/>;
}
function ScopedButton(){
  const [open,setOpen]=useState(false);const close=()=>setOpen(false);
  const {dialogProps,titleId}=useDialog(close,open);
  return <><button type="button" onClick={()=>setOpen(true)} className="min-h-11 border rounded px-3 mt-3">Tax certificates</button>
    {open&&createPortal(<div {...dialogProps} className="fixed inset-0 z-[700] bg-black/40 p-2 sm:p-4 flex items-center justify-center"><div className="w-full max-w-6xl max-h-[94dvh] overflow-y-auto bg-[var(--surface)] text-[var(--text)] border rounded-lg"><div className="p-3 flex items-center justify-between gap-2"><h2 id={titleId}>Tax certificate review</h2><button type="button" onClick={close} aria-label="Close tax certificate review" className="min-h-11 min-w-11 border rounded px-3">Close</button></div><Suspense fallback={<p role="status">Loading certificate review…</p>}><Certificates/></Suspense></div></div>,document.body)}
  </>;
}
