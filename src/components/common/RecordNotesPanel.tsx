import { secureId } from '../../lib/secureId';
/**
 * A-36 (tracker CD-06, CF-08): the notes panel — who wrote what, when, on one record. Notes are
 * plain and appended (threads and mentions are A-21's commentThreads); they live in the record's
 * own `metadata.recordNotes` and are saved through the existing updateEntity path, so a note
 * never changes an amount, a quantity or a posting. A note on a document in a locked period is
 * refused by the period lock like any other change to that document.
 */
import React, { useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { useEntityOperations } from '../../hooks/useEntityOperations';
import {
  addRecordNote, editRecordNote, NOTE_COLLECTIONS, noteProblem, notePreview, recordNotesFromMetadata,
  RECORD_NOTES_METADATA_KEY, searchRecordNotes,
  type NoteableType, type RecordNote,
} from '../../lib/recordNotes';
import {
  commentEditProblem,
  commentProblem,
  commentWhen,
  editedThreadComment,
  newThreadComment,
  threadComments,
  threadParticipants,
  type CommentEntityType,
  type ThreadComment,
} from '../../lib/commentThreads';
import type { Mentionable } from '../../lib/mentions';

const COMMENT_THREAD_METADATA_KEY = 'commentThread';

function commentThreadFromMetadata(metadata?: Record<string, unknown> | null): ThreadComment[] {
  const raw = metadata?.[COMMENT_THREAD_METADATA_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ThreadComment => (
    Boolean(item) &&
    typeof item === 'object' &&
    typeof (item as ThreadComment).id === 'string' &&
    typeof (item as ThreadComment).body === 'string' &&
    typeof (item as ThreadComment).createdAt === 'string' &&
    typeof (item as ThreadComment).entityType === 'string' &&
    typeof (item as ThreadComment).entityId === 'string'
  ));
}

export interface RecordNotesPanelProps {
  entityType: NoteableType;
  entityId: string;
  /** The record's name, for labels and messages. */
  entityName: string;
  /** The record's loaded metadata (its `recordNotes` are the notes shown). */
  metadata?: Record<string, unknown> | null;
  /** False: the panel shows the notes but takes none (a viewer or a guest). */
  canEdit?: boolean;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/** Notes on one record: newest first, with add and edit-own, plus @mention comment thread (A-21). */
export default function RecordNotesPanel({ entityType, entityId, entityName, metadata, canEdit = true }: RecordNotesPanelProps) {
  const workspaceId = useAuthStore(s => s.currentWorkspaceId) || '';
  const workspace = useAuthStore(s => s.getCurrentWorkspace());
  const user = useAuthStore(s => s.user);
  const { updateEntity } = useEntityOperations();
  const collection = NOTE_COLLECTIONS[entityType];
  const [saved, setSaved] = useState<RecordNote[] | null>(null);
  const [savedThread, setSavedThread] = useState<ThreadComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [problem, setProblem] = useState('');
  const [threadDraft, setThreadDraft] = useState('');
  const [threadEditId, setThreadEditId] = useState('');
  const [threadEditDraft, setThreadEditDraft] = useState('');
  const [threadProblem, setThreadProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const notes = useMemo(
    () => (saved ?? recordNotesFromMetadata(metadata)).filter(n => n.entityType === entityType && n.entityId === entityId),
    [saved, metadata, entityType, entityId],
  );
  const shown = filter ? searchRecordNotes(notes, filter) : notes;
  const authorUid = user?.uid || '';
  const authorName = user?.displayName || user?.email || undefined;

  const people = useMemo<Mentionable[]>(() => {
    const uids = new Set<string>();
    if (workspace?.uid) uids.add(workspace.uid);
    for (const uid of Object.keys(workspace?.roles || {})) uids.add(uid);
    if (user?.uid) uids.add(user.uid);
    const list: Mentionable[] = [];
    for (const uid of uids) {
      const email = uid === user?.uid ? user.email || `${uid}@workspace.local` : `${uid}@workspace.local`;
      list.push({ uid, email });
    }
    return list;
  }, [workspace, user]);

  const commentEntityType: CommentEntityType | null =
    entityType === 'transaction' ? null : entityType;

  const thread = useMemo(
    () => (commentEntityType ? threadComments(savedThread ?? commentThreadFromMetadata(metadata), commentEntityType, entityId, workspaceId || undefined) : []),
    [savedThread, metadata, commentEntityType, entityId, workspaceId],
  );
  const participants = useMemo(() => threadParticipants(thread), [thread]);

  const save = async (next: RecordNote[], message: string): Promise<boolean> => {
    setBusy(true);
    try {
      await updateEntity(collection, entityId, {
        metadata: {
          ...(metadata || {}),
          ...(savedThread ? { [COMMENT_THREAD_METADATA_KEY]: savedThread } : {}),
          [RECORD_NOTES_METADATA_KEY]: next,
        },
      }, message);
      setSaved(next);
      return true;
    } catch {
      // the refusal was reported; the note is not shown as saved
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveThread = async (nextThread: ThreadComment[], message: string): Promise<boolean> => {
    setBusy(true);
    try {
      await updateEntity(collection, entityId, {
        metadata: {
          ...(metadata || {}),
          ...(saved ? { [RECORD_NOTES_METADATA_KEY]: saved } : {}),
          [COMMENT_THREAD_METADATA_KEY]: nextThread,
        },
      }, message);
      setSavedThread(nextThread);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addThreadReply = async () => {
    if (!commentEntityType) return;
    const refusal = commentProblem(threadDraft);
    if (refusal) { setThreadProblem(refusal); return; }
    setThreadProblem('');
    const id = secureId('note_');
    if (!id) { setThreadProblem('Could not create a secure identifier. Try a different browser.'); return; }
    const created = newThreadComment(
      {
        id,
        workspaceId,
        entityType: commentEntityType,
        entityId,
        author: { uid: authorUid, ...(user?.displayName ? { name: user.displayName } : {}), ...(user?.email ? { email: user.email } : {}) },
        body: threadDraft,
      },
      people,
    );
    if (await saveThread([...thread, created], `Comment posted on ${entityName}`)) {
      setThreadDraft('');
    }
  };

  const editThreadReply = async (comment: ThreadComment) => {
    const canChangeProblem = commentEditProblem(comment, authorUid);
    if (canChangeProblem) { setThreadProblem(canChangeProblem); return; }
    const refusal = commentProblem(threadEditDraft);
    if (refusal) { setThreadProblem(refusal); return; }
    setThreadProblem('');
    const updated = editedThreadComment(comment, threadEditDraft, people);
    if (await saveThread(thread.map(c => (c.id === comment.id ? updated : c)), `Comment updated on ${entityName}`)) {
      setThreadEditId('');
      setThreadEditDraft('');
    }
  };

  const add = async () => {
    const text = draft;
    const refusal = noteProblem(text);
    if (refusal) { setProblem(refusal); return; }
    setProblem('');
    const id = secureId('note_');
    if (!id) { setProblem('Could not create a secure identifier. Try a different browser.'); return; }
    const note = addRecordNote({
      id, workspaceId, entityType, entityId, body: text, authorUid, ...(authorName ? { authorName } : {}),
    });
    if (await save([...notes, note], `Note saved on ${entityName}`)) setDraft('');
  };

  const edit = async (note: RecordNote) => {
    const refusal = noteProblem(editDraft);
    if (refusal) { setProblem(refusal); return; }
    setProblem('');
    if (await save(notes.map(n => (n.id === note.id ? editRecordNote(note, editDraft) : n)), `Note updated on ${entityName}`)) {
      setEditingId('');
      setEditDraft('');
    }
  };

  return (
    <section aria-label={`Notes on ${entityName}`} className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--text)]">Notes</h3>
      <p className="text-xs text-[var(--muted)]">
        Who wrote what, when, on <bdi>{entityName}</bdi>. Notes are kept on this record and never change an amount.
        Card numbers in a note are masked before it is saved.
      </p>

      {canEdit && (
        <div className="space-y-2" data-print-hide>
          <label className="flex flex-col gap-1 text-sm">
            New note
            <textarea
              aria-label={`New note on ${entityName}`}
              rows={3}
              value={draft}
              onChange={e => { setDraft(e.target.value); if (problem) setProblem(''); }}
              placeholder="What should someone know about this record?"
              className="w-full border rounded px-3 py-2 bg-[var(--panel)] text-[var(--text)]"
              dir="auto"
            />
          </label>
          {problem && <p role="alert" className="text-xs text-red-600">{problem}</p>}
          <button type="button" onClick={add} disabled={busy}
            className="min-h-11 px-4 rounded border border-[var(--line)] disabled:opacity-50">
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm max-w-sm">
        Search these notes
        <input type="search" aria-label={`Search notes on ${entityName}`} value={filter}
          onChange={e => setFilter(e.target.value)} placeholder="A word in the note or its author"
          className="min-h-11 border rounded px-3 bg-[var(--panel)] text-[var(--text)]" dir="auto" />
      </label>

      {shown.length === 0 && (
        <p className="text-sm text-[var(--muted)]">
          {notes.length === 0 ? 'No notes on this record yet.' : 'No note matches this search.'}
        </p>
      )}
      <ul className="space-y-2">
        {shown.map(note => (
          <li key={note.id} className="border border-[var(--line)] rounded p-2">
            <p className="text-xs text-[var(--muted)]">
              <bdi>{note.authorName || 'Someone'}</bdi>
              {' · '}
              <time dateTime={note.createdAt}>{when(note.createdAt)}</time>
              {note.editedAt ? ' · edited' : ''}
            </p>
            {editingId === note.id ? (
              <div className="space-y-2">
                <textarea aria-label={`Change note on ${entityName}`} rows={3} value={editDraft}
                  onChange={e => setEditDraft(e.target.value)}
                  className="w-full border rounded px-3 py-2 bg-[var(--panel)] text-[var(--text)]" dir="auto" />
                {problem && <p role="alert" className="text-xs text-red-600">{problem}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={() => edit(note)} disabled={busy}
                    className="min-h-11 px-3 rounded border border-[var(--line)] disabled:opacity-50">Save note</button>
                  <button type="button" onClick={() => { setEditingId(''); setProblem(''); }}
                    className="min-h-11 px-3 rounded border border-[var(--line)]">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap" dir="auto">{note.body}</p>
                {canEdit && authorUid && note.authorUid === authorUid && (
                  <button type="button" data-print-hide
                    aria-label={`Change note on ${entityName}: ${notePreview(note)}`}
                    onClick={() => { setEditingId(note.id); setEditDraft(note.body); setProblem(''); }}
                    className="text-xs text-[var(--muted)] hover:underline">
                    Change
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {commentEntityType && (
        <div className="pt-3 border-t border-[var(--line)] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[var(--text)]">Comment thread (@mentions, 10-minute own-edit)</h4>
            {participants.length > 0 && (
              <span className="text-xs text-[var(--muted)]">
                Participants: {participants.map(p => p.name || p.email || p.uid).join(', ')}
              </span>
            )}
          </div>
          {thread.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No thread comments on this record yet.</p>
          ) : (
            <ul className="space-y-2">
              {thread.map(comment => {
                const editRefusal = commentEditProblem(comment, authorUid);
                return (
                  <li key={comment.id} className="border border-[var(--line)] rounded p-2 text-xs space-y-1">
                    <div className="text-[var(--muted)]">
                      <bdi>{comment.authorName || comment.authorEmail || comment.authorUid || 'Someone'}</bdi>
                      {' · '}
                      <span>{commentWhen(comment) || when(comment.createdAt)}</span>
                      {comment.editedAt ? ' · edited' : ''}
                      {comment.mentions.length > 0 ? ` · mentioned: ${comment.mentions.join(', ')}` : ''}
                    </div>
                    {threadEditId === comment.id ? (
                      <div className="space-y-1">
                        <textarea
                          aria-label={`Edit comment on ${entityName}`}
                          rows={2}
                          value={threadEditDraft}
                          onChange={e => setThreadEditDraft(e.target.value)}
                          className="w-full border rounded px-2 py-1 bg-[var(--panel)] text-[var(--text)] text-sm"
                          dir="auto"
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void editThreadReply(comment)} disabled={busy}
                            className="px-2 py-1 rounded border border-[var(--line)]">Save comment</button>
                          <button type="button" onClick={() => { setThreadEditId(''); setThreadProblem(''); }}
                            className="px-2 py-1 rounded border border-[var(--line)]">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm whitespace-pre-wrap text-[var(--text)]" dir="auto">{comment.body}</p>
                        {canEdit && !editRefusal && (
                          <button
                            type="button"
                            data-print-hide
                            aria-label={`Edit comment on ${entityName}`}
                            onClick={() => {
                              setThreadEditId(comment.id);
                              setThreadEditDraft(comment.body);
                              setThreadProblem('');
                            }}
                            className="text-xs text-[var(--muted)] hover:underline"
                          >
                            Edit comment
                          </button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canEdit && (
            <div className="space-y-1" data-print-hide>
              <label className="flex flex-col gap-1 text-xs">
                Reply in thread (use @name or @email to mention teammates)
                <input
                  type="text"
                  aria-label={`New comment on ${entityName}`}
                  value={threadDraft}
                  onChange={e => { setThreadDraft(e.target.value); if (threadProblem) setThreadProblem(''); }}
                  placeholder="Write a comment or @mention a teammate"
                  className="min-h-9 border rounded px-2 bg-[var(--panel)] text-[var(--text)] text-sm"
                  dir="auto"
                />
              </label>
              {threadProblem && <p role="alert" className="text-xs text-red-600">{threadProblem}</p>}
              <button
                type="button"
                onClick={() => void addThreadReply()}
                disabled={busy}
                className="px-3 py-1 rounded border border-[var(--line)] text-xs disabled:opacity-50"
              >
                Post comment
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
