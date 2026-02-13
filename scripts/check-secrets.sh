#!/usr/bin/env bash
# Pre-commit hook: detect accidentally staged secrets.
# Install: cp scripts/check-secrets.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -euo pipefail

# Patterns that indicate leaked secrets (case-insensitive where needed)
PATTERNS=(
  'DATABASE_URL=.+'
  'DIRECT_URL=.+'
  'JWT_SECRET=.+'
  'ENCRYPTION_KEY=.+'
  'ANTHROPIC_API_KEY=sk-ant-'
  'E2B_API_KEY=.+'
  'PRIVY_APP_SECRET=.+'
  'UPSTASH_REDIS_REST_TOKEN=.+'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  'password\s*[:=]\s*["\x27][^"\x27]{8,}'
)

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

FOUND=0

for pattern in "${PATTERNS[@]}"; do
  # Search staged content (not working tree) for secrets
  MATCHES=$(git diff --cached -U0 | grep -iE "^\+.*${pattern}" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    if [ "$FOUND" -eq 0 ]; then
      echo "🚨 SECRET DETECTED in staged changes:"
      echo ""
    fi
    echo "  Pattern: $pattern"
    echo "$MATCHES" | head -3 | sed 's/^/    /'
    echo ""
    FOUND=1
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo "❌ Commit blocked. Remove secrets from staged files before committing."
  echo "   Use 'git reset HEAD <file>' to unstage, or add to .gitignore."
  echo "   To bypass (NOT recommended): git commit --no-verify"
  exit 1
fi

exit 0
