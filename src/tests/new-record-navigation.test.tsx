import "./helpers/dom";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import React, { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import {
  NEW_RECORD_TABS,
  newRecordHash,
  parseRecordHash,
  type NewRecordType,
} from "../lib/recordLinks";
import { useAuthStore } from "../stores/useAuthStore";
import { useUIStore } from "../stores/useUIStore";
import { useNewRecord } from "../hooks/useNewRecord";

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    workspaces: [],
    currentWorkspaceId: null,
  });
  window.history.replaceState(null, "", "#dashboard");
  useUIStore.setState({
    activeTab: "dashboard",
    newRecord: null,
    focusRecord: null,
  });
});
afterEach(cleanup);

for (const type of Object.keys(NEW_RECORD_TABS) as NewRecordType[]) {
  test(`${type}: typed new link round-trips to its registered screen`, () => {
    assert.deepEqual(parseRecordHash(`#${newRecordHash(type)}`), {
      tab: NEW_RECORD_TABS[type],
      create: type,
    });
    useUIStore.getState().openNewRecord(type);
    assert.equal(useUIStore.getState().newRecord, type);
    assert.equal(useUIStore.getState().activeTab, NEW_RECORD_TABS[type]);
    assert.equal(window.location.hash, `#${newRecordHash(type)}`);
    useUIStore.getState().clearNewRecord();
    assert.equal(window.location.hash, `#${NEW_RECORD_TABS[type]}`);
    assert.equal(useUIStore.getState().newRecord, null);
  });
}

test("unknown and wrong-screen creation targets do not open forms", () => {
  for (const hash of [
    "#sales/vendor/new",
    "#sales/nope/new",
    "#ledger/invoice/new",
    "#sales/invoice/new/extra",
  ]) {
    assert.equal(parseRecordHash(hash).create, undefined);
  }
});

test("ordinary navigation cancels a pending request, and existing record links still work", () => {
  const ui = useUIStore.getState();
  ui.openNewRecord("invoice");
  ui.setActiveTab("reports");
  assert.equal(useUIStore.getState().newRecord, null);
  ui.openNewRecord("invoice");
  ui.navigateTool("reports");
  assert.equal(useUIStore.getState().newRecord, null);
  ui.openNewRecord("bill");
  ui.openRecord({ type: "invoice", id: "saved-invoice" });
  assert.equal(useUIStore.getState().newRecord, null);
  assert.deepEqual(parseRecordHash(window.location.hash), {
    tab: "sales",
    record: { type: "invoice", id: "saved-invoice" },
  });
});

function Target({
  allowed = true,
  create,
}: {
  allowed?: boolean;
  create: () => void;
}) {
  useNewRecord("invoice", allowed, create);
  return null;
}

test("empty-list destination consumes once in StrictMode and permits repeated creation", () => {
  let calls = 0;
  const create = () => {
    calls++;
  };
  act(() => useUIStore.getState().openNewRecord("invoice"));
  const view = render(
    <StrictMode>
      <Target create={create} />
    </StrictMode>,
  );
  assert.equal(calls, 1);
  view.rerender(
    <StrictMode>
      <Target create={create} />
    </StrictMode>,
  );
  assert.equal(calls, 1);
  act(() => useUIStore.getState().openNewRecord("invoice"));
  assert.equal(calls, 2);
  assert.equal(useUIStore.getState().newRecord, null);
});

test("viewer request is refused and consumed, not resurrected on a later permission change", () => {
  let calls = 0;
  const create = () => {
    calls++;
  };
  act(() => useUIStore.getState().openNewRecord("invoice"));
  const view = render(<Target allowed={false} create={create} />);
  assert.equal(calls, 0);
  assert.equal(useUIStore.getState().newRecord, null);
  view.rerender(<Target allowed create={create} />);
  assert.equal(calls, 0);
});

test("a cold creation link waits for workspace membership instead of mistaking loading for viewer access", () => {
  let calls = 0;
  const create = () => {
    calls++;
  };
  useAuthStore.setState({
    user: { uid: "owner" } as never,
    currentWorkspaceId: "cold-books",
  });
  useUIStore.getState().openNewRecord("invoice");
  const view = render(<Target allowed={false} create={create} />);
  assert.equal(useUIStore.getState().newRecord, "invoice");
  assert.equal(calls, 0);
  act(() => {
    useAuthStore.setState({
      workspaces: [{ id: "cold-books", uid: "owner" } as never],
    });
    view.rerender(<Target allowed create={create} />);
  });
  assert.equal(calls, 1);
  assert.equal(useUIStore.getState().newRecord, null);
});
