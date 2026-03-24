# Exploratory Testing Report (2026-03-24)

## Scope

- Target app: `http://localhost:8089/`
- Related backend endpoints: `/mcp/*` (proxied to `:9091`)
- Method: high-intensity exploratory session with parallel codebase search, external reference research, scripted checks, and real-browser validation

## Evidence Collected

### 1) Automated checks

- `bash docs/test/mcp/curl_smoke_test.sh`
  - Result: 23/24 pass
  - Reproducible failure: `graph_aggregate` -> Neo4j syntax error (`Invalid input ')'`)
- `E2E_BASE_URL=http://localhost:8089 npx playwright test tests/01-project-list.spec.ts tests/03-graph-review.spec.ts tests/08-full-workflow.spec.ts`
  - Result: 5 passed, 6 failed, 1 skipped
  - Failure clusters: fragile selectors, strict-mode multi-match, click interception in SVG graph layer

### 2) Real-browser exploratory checks (Playwright MCP)

- Project creation via labeled input works
- In one exploratory run, create action stayed on `/` (did not auto-enter `/project/:id/build`)
- UI deletion attempt for new project card did not complete; deletion via MCP API succeeded
- Graph page:
  - Clicking visible label text did not navigate to class editor
  - Dispatching click on `svg circle` navigated correctly to `/class/...`
  - AI panel opens and is visible
- Review report page:
  - Publish button enabled for tested project
  - Navigation from report to publish page works
- Publish pipeline:
  - In this session, one scenario completed successfully
  - Historical session also observed a duplicate YAML key parse failure in pipeline path
- Runtime quality signals:
  - Browser console warnings/errors: 0
  - Network requests during checks: observed `POST /mcp/` responses were `200`

### 3) High-signal static analysis

- E2E tests include heavy fixed sleeps: `waitForTimeout(...)` appears 42 times under `docs/test/e2e/tests`
- Selector brittleness pattern is widespread:
  - positional locators: `.first()`, `.last()`, `.nth()`
  - broad class substring matchers: `[class*="..."]`
  - generic input targets: `input[type="text"]`

## Triage Matrix

### Confirmed product defects

1. P0 - `graph_aggregate` syntax failure (high confidence)
   - Why: reproducible in MCP smoke baseline with stable 23/24 pattern
   - Impact: graph aggregation capability is unavailable in smoke path

2. P0 - UI delete flow for newly created project does not complete (high confidence)
   - Why: reproducible via real browser; backend delete by ID works via MCP
   - Impact: destructive action reliability is inconsistent in UI

### Likely test-suite brittleness (not direct product breakage)

1. Playwright create-flow fails on `input[type="text"]` while labeled textbox path works manually (high confidence)
2. Strict-mode multi-match caused by broad locators in sidebar checks (high confidence)
3. Graph click failures caused by pointer interception (`svg text` over node click layer) in current test interaction strategy (high confidence)
4. AI modal locator mismatch in tests while actual panel is visible in exploratory run (high confidence)

### Integration-risk hypotheses (needs focused validation)

1. Frontend-graph contract risk (medium confidence)
   - Explore findings indicate potential mismatch in neighbors response shape consumption
2. YAML wrapped/flat and duplicate-key robustness risk (medium confidence)
   - Historical failure + parser shape variability suggest fragility along validate/merge/pipeline path

## Recommended Next Validation Charters

1. Charter A - Graph aggregate failure isolation
   - Re-run failing `graph_aggregate` input 10 times with captured request/response payloads
   - Goal: determine deterministic parser error trigger and exact malformed Cypher fragment

2. Charter B - Project delete UX contract
   - Exercise delete via card action and confirmation dialog under normal/rapid clicks
   - Goal: verify request dispatch, optimistic UI refresh, and post-delete list consistency

3. Charter C - Graph interaction layer
   - Compare label click vs shape click behavior for class navigation
   - Goal: confirm intended UX and eliminate click-layer ambiguity

4. Charter D - YAML robustness through publish path
   - Feed wrapped, flat, and duplicate-key samples through save/read/validate/run_pipeline
   - Goal: confirm where invalid YAML is blocked and whether error messaging is actionable

## External Practices Applied / Referenced

- Session-based exploratory framing (SBTM):
  - https://www.satisfice.com/download/session-based-test-management
- Heuristic strategy model (HTSM):
  - https://www.satisfice.com/download/heuristic-test-strategy-model
- Tour-based exploratory testing ideas:
  - https://learn.microsoft.com/en-us/archive/blogs/james_whittaker/the-touring-test
- Playwright API-assisted testing guidance:
  - https://playwright.dev/docs/api-testing
  - https://playwright.dev/docs/api/class-apirequestcontext
- Neo4j aggregate syntax reference (`count(input)` / `count(*)`):
  - https://neo4j.com/docs/cypher-manual/current/functions/aggregating/

## Immediate Action Order

1. Fix and verify `graph_aggregate` (P0)
2. Fix project deletion UI flow and re-check list refresh/confirmation behavior (P0)
3. Harden Playwright locators and remove fixed-sleep dependency in high-failure specs (P1)
4. Add wrapped/flat/duplicate-key YAML regression checks in publish path (P1)
