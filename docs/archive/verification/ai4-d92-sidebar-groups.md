# AI #4 — D-92 sidebar groups and names

Base main 3ca3ec2f. Previous #192/#194 are merged; #194 CI passed. AI #1 fixed #192's remaining summary accessible-name failure in 3059fdb6, verified by six dashboard/settings browser checks.

Main navigation now has Daily work, Sales and purchases, Reports and settings sections. Existing English/Hebrew page labels, registry IDs, callbacks, pro-mode/admin filtering and bookmark behavior remain. Future registry groups appear in the last section rather than disappearing. Each navigation button has a 44px target, named tooltip and current-page marker; icons are decorative. “Search pages” replaces “Command Bar” and its “Global Coordinate Search” tooltip, using the existing command-palette action. The previous D-82 Projects/Account totals/Book summary labels and truthful amount explanations stay unchanged. No financial aggregation or posting change.

W1 navigation evidence only; complete onboarding remains Partly. Reserved invoice/bill/banking screens are untouched.

Four Chromium phone/desktop × light/dark cases check all seven destinations in their sections, 44px geometry, current-page state, preserved sales route by Enter, one command palette with focused search and Escape, collapsed desktop icon names/tooltips/report navigation, absence of page overflow, balance-box caption and serious/critical axe findings in navigation. Full CI and Linux visual review pending. Before sidebar is visible in the main-branch dashboard reference images; after menu screenshots attach to the new browser spec.


Final focused results: new sidebar checks 4/4 passed (16.4s); unchanged keyboard/bookmark checks 4/4 passed (10.1s), including the existing keyboard-only invoice journey. Types and changed-file ESLint pass, zero errors/warnings. New phone tests retain the existing open-menu behavior after navigation and wait for command-search focus before Escape.

Linux visual run 39363796508 / job 118435824417: all 20 desktop captures passed (53.9s); the full 40-reference set passed (1.1m). Reviewed all 20 sidebar panels, including their footer controls. Sixteen images differ only inside the sidebar. Four have 45–520 sparse raw-RGB differences elsewhere (header text/controls and transaction text); their before/after regions were inspected, with labels and financial figures unchanged. Only Sidebar.tsx production code changed. All 20 candidate references accepted after review; temporary capture trigger removed. Complete PR CI pending.
