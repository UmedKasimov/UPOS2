# UPOS performance baseline

Date: 2026-08-25

Measurements were collected from `https://app.u-pos.uz` after navigation settled for
250 ms. They are a practical regression baseline rather than synthetic Lighthouse
scores.

| Route | First visible (ms) | DOM nodes | Scripts | Stylesheets | Table rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/dashboard` | 557 | 360 | 26 | 4 | 0 |
| `/sales` | 2,105 | 4,958 | 30 | 6 | 103 |
| `/finance` | 1,351 | 655 | 26 | 4 | 0 |
| `/products` | 1,845 | 12,859 | 29 | 4 | 215 |
| `/warehouse` | 1,106 | 8,016 | 26 | 4 | 297 |
| `/clients` | 622 | 7,605 | 27 | 4 | 185 |
| `/crm` | 1,517 | 5,820 | 26 | 4 | 0 |
| `/telephony` | 2,217 | 53,435 | 28 | 4 | 2,796 |
| `/messengers` | 1,243 | 3,631 | 28 | 4 | 0 |
| `/reports` | 2,762 | 10,097 | 27 | 4 | 444 |
| `/settings` | 1,256 | 320 | 30 | 4 | 0 |

## Main findings

- Every route loaded approximately 26 global scripts. Warehouse purchases (168 KB),
  table column controls (44 KB), and device settings (12 KB) were downloaded even on
  unrelated screens.
- The global `styles.css` is approximately 814 KB.
- Telephony renders all contacts and produces more than 53,000 DOM nodes.
- Products, reports, warehouse, and clients render thousands of nodes before the user
  interacts with their tables.
- Warmup previously fetched ten core routes and their assets after every login, which
  competed with the current screen.
- AJAX filters ignored stale responses by sequence number, but did not cancel their
  network and server work.

## Stage 1 changes

- Consolidate small shared runtime files into generated `app-core.js`.
- Load table controls, date range controls, warehouse purchases, and device settings
  only on routes that use them.
- Keep device heartbeat in a small shared module.
- Abort superseded AJAX filter requests and cache only completed responses.
- Limit idle warmup to likely next routes, with one concurrent request and reduced work
  on constrained devices.
- Render the large telephony contact table as a virtual window while keeping the full
  contact dataset available to search, selection, editing, and deletion.
- Replace the warehouse journal's per-purchase JSON script nodes with one indexed JSON
  payload.

## Stage 1 verification

These measurements were collected from the local application connected to the same
Airnet data services. Server timings vary with the live database, so DOM and resource
counts are the primary acceptance criteria for this stage.

| Route | DOM nodes | Total scripts | External scripts | Table data / rendered rows |
| --- | ---: | ---: | ---: | ---: |
| `/clients` | 7,627 | 9 | 7 | 186 rows |
| `/warehouse` | 7,913 | 14 | 9 | 297 rows; 1 purchase JSON payload |
| `/telephony#numbers` | 5,813 | 10 | 8 | 2,676 contacts / 27-32 rendered rows |

- The clients route now loads seven external scripts instead of 27 total script files;
  warehouse and device-settings modules are absent on that route.
- Telephony DOM size fell from 53,435 to about 5,813 nodes while preserving the full
  2,676-contact dataset. Scrolling changes the rendered window and keeps only about 30
  contact rows in the DOM.
- Warehouse now emits one indexed purchase payload instead of one script node per
  purchase; purchase detail opening was verified after the change.
- Superseded filter requests are actively aborted and repeated completed responses are
  served from a short-lived in-memory cache.
- Shared warmup is bounded to one concurrent request and at most three likely routes;
  it is reduced or disabled on constrained connections.

## Production verification

The first deployment was verified on `https://app.u-pos.uz` with the live Airnet
containers and production data:

| Route | DOM nodes | External scripts | Verification |
| --- | ---: | ---: | --- |
| `/clients` | 7,627 | 7 | Warehouse and device-settings scripts absent; AJAX filter updates URL and table |
| `/warehouse` | 7,902 | 9 | One purchase payload; purchase detail opens from the indexed payload |
| `/telephony#numbers` | 5,824 | 7 | 2,676 contacts; about 32 rows rendered in the virtual window |

- The clients page loads seven external scripts instead of the previous 27 script
  files, a reduction of approximately 74 percent.
- Telephony DOM size fell by approximately 89 percent, from 53,435 to about 5,824
  nodes, without dropping contacts from search or actions.
- Superseded client-filter requests are aborted; the latest response replaces only
  the directory panel and keeps the URL synchronized.
- Duplicate global stylesheet and shared date/amount runtime includes were removed
  from warehouse, reports, account, and cash templates.

## Rollout order

This stage deliberately keeps server-rendered fallbacks and existing URLs intact. The
next optimization stages can split the remaining large route CSS and virtualize other
high-volume tables after their editing and selection workflows have dedicated
regression coverage.

Later stages should use this baseline to prioritize telephony and large table
virtualization. Business rules, authorization, URLs, and server-rendered fallbacks must
remain unchanged.
