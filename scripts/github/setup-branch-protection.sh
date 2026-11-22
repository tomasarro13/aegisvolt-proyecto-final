#!/usr/bin/env bash
# =============================================================================
# Gobernanza de Git: crea las ramas de ambiente (dev, test, prod) y un Ruleset que,
# para las tres ramas:
#   - bloquea force push (non_fast_forward) y el borrado de la rama,
#   - prohíbe el push directo: todo cambio entra por Pull Request,
#   - exige los checks de CI en verde antes del merge (strict = rama actualizada).
# Requiere: gh autenticado con permisos de admin sobre el repositorio.
# Uso: scripts/github/setup-branch-protection.sh <owner>/<repo>
# =============================================================================
set -euo pipefail
REPO="${1:?Uso: $0 <owner>/<repo>}"
CHECKS=(promotion-guard lint-build unit-tests integration-tests e2e-tests terraform-plan)

DEFAULT_SHA=$(gh api "repos/$REPO/commits/HEAD" --jq .sha)
for b in dev test prod; do
  if ! gh api "repos/$REPO/branches/$b" >/dev/null 2>&1; then
    gh api -X POST "repos/$REPO/git/refs" -f ref="refs/heads/$b" -f sha="$DEFAULT_SHA" >/dev/null
    echo "rama $b creada"
  fi
done
gh api -X PATCH "repos/$REPO" -f default_branch=dev >/dev/null

checks_json=$(printf '%s\n' "${CHECKS[@]}" | jq -R '{context: .}' | jq -s .)
payload=$(jq -n --argjson checks "$checks_json" '{
  name: "aegisvolt-environment-branches",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/dev", "refs/heads/test", "refs/heads/prod"], exclude: [] } },
  bypass_actors: [],
  rules: [
    { type: "non_fast_forward" },
    { type: "deletion" },
    { type: "pull_request", parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true } },
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: $checks } }
  ]
}')

existing=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="aegisvolt-environment-branches") | .id' || true)
if [ -n "$existing" ]; then
  echo "$payload" | gh api -X PUT "repos/$REPO/rulesets/$existing" --input - >/dev/null && echo "ruleset actualizado ($existing)"
else
  echo "$payload" | gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null && echo "ruleset creado"
fi

# Ambientes de GitHub (el CD usa environment: <rama>). En prod se puede exigir aprobación manual.
for env in dev test prod; do
  gh api -X PUT "repos/$REPO/environments/$env" >/dev/null && echo "environment $env listo"
done
echo "Listo. Pruebe: git push --force origin test  => rechazado por el ruleset"
