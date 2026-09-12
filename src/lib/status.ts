/** The status state machine and the action matrix (docs/02-data-model.md).
 *
 *  Status is never a boolean. Every list row and detail view asks
 *  `actionsFor()` what it may show; no component checks a status string on
 *  its own (docs/15, bug 2). */

export type Status = "open" | "adjournment_sought" | "response_submitted" | "closed" | "unknown";

export const STATUSES: Status[] = ["open", "adjournment_sought", "response_submitted", "closed", "unknown"];

export function parseStatus(raw: string | null | undefined): Status {
  switch (raw) {
    case "open": case "adjournment_sought": case "response_submitted": case "closed":
      return raw;
    default:
      return "unknown";
  }
}

/** Sentence case, for pills. */
export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  adjournment_sought: "Adjournment sought",
  response_submitted: "Response submitted",
  closed: "Closed",
  unknown: "Status not stated",
};

/** Disposed one way or another: dates no longer drive urgency. */
export function isSettled(status: Status): boolean {
  return status === "closed" || status === "response_submitted";
}

export interface Actions {
  view: boolean;
  save: boolean;
  draft: boolean;
  editManualDueDate: boolean;
}

/** The action matrix, verbatim from docs/02. View and Save are always on;
 *  only Draft (and the manual date) are withheld. */
const MATRIX: Record<Status, Actions> = {
  open:               { view: true, save: true, draft: true,  editManualDueDate: true },
  adjournment_sought: { view: true, save: true, draft: true,  editManualDueDate: true },
  response_submitted: { view: true, save: true, draft: false, editManualDueDate: false },
  closed:             { view: true, save: true, draft: false, editManualDueDate: false },
  unknown:            { view: true, save: true, draft: false, editManualDueDate: true },
};

export function actionsFor(status: Status | string | null | undefined): Actions {
  return MATRIX[parseStatus(typeof status === "string" ? status : null)];
}

/** Transitions the machine allows (docs/02). Anything else is refused. */
const TRANSITIONS: Record<Status, Status[]> = {
  open: ["adjournment_sought", "response_submitted", "closed"],
  adjournment_sought: ["open", "closed"],
  response_submitted: ["closed"],
  closed: [],
  unknown: ["open", "adjournment_sought", "response_submitted", "closed"],
};

export function canTransition(from: Status, to: Status): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
