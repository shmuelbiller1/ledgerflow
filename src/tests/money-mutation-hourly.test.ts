import test from "node:test";
import assert from "node:assert/strict";
import {
  hourlyGrossCents,
  hourlyProblem,
  hoursToPay,
  isHourly,
  asPaidFor,
} from "../lib/hourlyPay";
import type { Employee } from "../types";

const employee = (changes: Partial<Employee> = {}): Employee => ({
  id: "hourly",
  uid: "owner",
  workspaceId: "books",
  name: "Hourly person",
  role: "Staff",
  salaryCents: 0,
  payFrequency: "Bi-Weekly",
  status: "Active",
  createdAt: "2024-01-01",
  payType: "hourly",
  hourlyRateCents: 2550,
  timeUid: "person",
  ...changes,
});

test("hourly pay rounds once and carries the exact period gross into each pay frequency", () => {
  const person = employee();
  assert.equal(isHourly(person), true);
  assert.equal(isHourly(employee({ payType: "salary" })), false);
  assert.equal(hourlyGrossCents(person, 61), 2593); // 61 × 2550 ÷ 60 = 2592.5 cents.
  assert.equal(hourlyGrossCents(person, 1), 43);
  assert.equal(hourlyGrossCents(person, 0), 0);
  assert.equal(asPaidFor(person, 61).salaryCents, 67418); // 2593 × 26.
  assert.equal(
    asPaidFor(employee({ payFrequency: "Weekly" }), 61).salaryCents,
    134836,
  );
  assert.equal(
    asPaidFor(employee({ payFrequency: "Monthly" }), 61).salaryCents,
    31116,
  );
  assert.equal(person.salaryCents, 0, "the source employee is unchanged");
  assert.equal(hourlyProblem(person), null);
  assert.match(
    hourlyProblem(employee({ hourlyRateCents: 0 })) || "",
    /hourly rate/,
  );
  assert.match(
    hourlyProblem(employee({ timeUid: undefined })) || "",
    /whose time/,
  );
  assert.equal(
    hourlyProblem(
      employee({ payType: "salary", hourlyRateCents: 0, timeUid: undefined }),
    ),
    null,
  );
});

test("only this person’s approved or invoiced, unpaid time through the cutoff is paid", () => {
  const entries = [
    {
      id: "approved",
      person: "person",
      date: "2024-02-29",
      minutes: 61,
      status: "approved",
    },
    {
      id: "invoiced",
      person: "person",
      date: "2024-02-28",
      minutes: 30,
      status: "invoiced",
    },
    {
      id: "future",
      person: "person",
      date: "2024-03-01",
      minutes: 100,
      status: "approved",
    },
    {
      id: "draft",
      person: "person",
      date: "2024-02-28",
      minutes: 100,
      status: "draft",
    },
    {
      id: "paid",
      person: "person",
      date: "2024-02-28",
      minutes: 100,
      status: "approved",
      paidRunId: "prior",
    },
    {
      id: "other",
      person: "other",
      date: "2024-02-28",
      minutes: 100,
      status: "approved",
    },
  ];
  const before = JSON.stringify(entries);
  const result = hoursToPay(
    [
      employee(),
      employee({ id: "salary", payType: "salary" }),
      employee({ id: "unlinked", timeUid: undefined }),
    ],
    entries,
    "2024-02-29",
  );
  assert.deepEqual(
    [...result],
    [["hourly", { minutes: 91, entryIds: ["approved", "invoiced"] }]],
  );
  assert.equal(JSON.stringify(entries), before);
});

test("hourly configuration refuses noninteger, unsafe and missing rates without changing salary employees", () => {
  for (const rate of [
    undefined,
    -1,
    0,
    0.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.match(
      hourlyProblem(employee({ hourlyRateCents: rate })) || "",
      /hourly rate/,
    );
  assert.equal(
    hourlyGrossCents(employee({ hourlyRateCents: undefined }), 60),
    0,
  );
  assert.equal(hourlyGrossCents(employee({ hourlyRateCents: NaN }), 60), 0);
  assert.match(hourlyProblem(employee({ timeUid: "" })) || "", /whose time/);
  assert.equal(isHourly(employee({ payType: undefined })), false);
  assert.deepEqual(
    [...hoursToPay([employee()], [], "2024-02-29")],
    [["hourly", { minutes: 0, entryIds: [] }]],
  );
});
