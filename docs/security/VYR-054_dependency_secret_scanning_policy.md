# VYR-054: Dependency Scanning, Secret Scanning & Vulnerability Remediation Policy

## 1. Dependency / SCA Scanning

### Scope
Both `backend/` and `frontend/` are independently scanned on every push,
pull request, and weekly (Monday 06:00 UTC).

### Tooling
| Tool | Purpose | Trigger |
|------|---------|---------|
| `npm audit` | Known-vulnerability check against npm advisory DB | Every CI run |
| GitHub CodeQL | Static analysis for JS/TS security patterns | Every CI run |
| Dependabot (GitHub-native) | Automatic PR creation for outdated dependencies | Continuous |

### Severity-Based Remediation SLAs

| Severity | Response SLA | Remediation SLA | Escalation |
|----------|-------------|-----------------|------------|
| **Critical** | 24 hours | 72 hours | Project lead + security team |
| **High** | 72 hours | 7 calendar days | Project lead |
| **Moderate** | 7 days | 30 calendar days | Triaged in sprint |
| **Low / Info** | 30 days | Next release cycle | Backlog |

### Exception / Risk-Acceptance Process
When no upstream fix exists (e.g., `xlsx` prototype-pollution — GHSA-4r6h-8v6p-xvw6):

1. **Document** the finding in a risk-acceptance record below.
2. **Mitigate** via input validation, sandboxing, or usage constraints.
3. **Approve** — project lead signs off; record the date and re-review cadence.
4. **Re-evaluate** every 30 days or when a fix becomes available.

## 2. Secret Scanning

### Scope
Full repository history is scanned on every push and pull request using
[Gitleaks](https://github.com/gitleaks/gitleaks) with the project config
at `.gitleaks.toml`.

### Rules
- **No secrets in source control.** All credentials, API keys, tokens, and
  private keys live in environment variables or a secrets manager.
- `.env` files are git-ignored. `.env.example` files contain only placeholder
  values (`REPLACE_WITH_...` or empty strings).
- Signing keys are generated at runtime (see VYR-020 JWKS endpoint).
- Oracle Fusion credentials are injected via `FUSION_USER` / `FUSION_PASSWORD`
  environment variables, never committed.

### Allowlisted Patterns
Placeholder hostnames (`eiiv-dev14.fa.us6.oraclecloud.com`) and template
tokens (`your-tenant-id-here`, `REPLACE_WITH_*`) are allowlisted because
they are non-secret configuration examples.

## 3. Risk-Accepted Vulnerabilities

| Package | Severity | Advisory | Mitigation | Accepted | Re-review |
|---------|----------|----------|------------|----------|-----------|
| `xlsx` | High | GHSA-4r6h-8v6p-xvw6 (Prototype Pollution) | Input files are admin-uploaded only; parsed in isolated route handler; no user-supplied prototype chain keys | 2026-11-17 | 2026-12-17 |
| `xlsx` | High | GHSA-5pgg-2g8v-p4x9 (ReDoS) | File size capped at 2MB (VYR-049); upload restricted to authenticated admins | 2026-11-17 | 2026-12-17 |

## 4. Branch-Independent Scanning
Both `veyra-application-dev` and `standard-veyra-application-dev` trigger
their own CI scans. The AI-free branch may have a smaller dependency tree
(no LLM libraries), so each branch's audit report reflects its actual
supply chain.

## 5. Gitignore Hardening
The repository `.gitignore` excludes:
- `.env` files (all variants)
- Private keys (`*.pem`, `*.key`, `*.p12`, `*.pfx`)
- Credential JSON files (`*credentials*.json`, `*secret*.json`)
- IDE-local secrets (`.claude/settings.local.json`)
