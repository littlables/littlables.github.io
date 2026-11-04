#!/bin/bash
# Test runner with clean summary output for CI logs.
# Runs all worker test files and prints failed test names at the end.
# Exit code: 0 if all pass, 1 if any fail.

set -u

cd "$(dirname "$0")/.." || exit 1

TEST_FILES=(
  "cloudflare-worker/src/index.test.mjs"
  "cloudflare-worker/src/news-storage.test.mjs"
  "cloudflare-worker/src/feed-utils.test.mjs"
  "cloudflare-worker/src/news-provider-config.test.mjs"
  "cloudflare-worker/src/embedding-classifier.test.mjs"
  "cloudflare-worker/src/staggered-sync.test.mjs"
  "cloudflare-worker/src/ai-usage-log.test.mjs"
  "cloudflare-worker/src/lil-usage-log.test.mjs"
  "cloudflare-worker/src/provider-sync-runs.test.mjs"
  "cloudflare-worker/src/taste-reader.test.mjs"
)

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_TESTS=()

echo "========================================"
echo " Cloudflare Worker Unit Tests"
echo "========================================"
echo ""

for TEST_FILE in "${TEST_FILES[@]}"; do
  if [ ! -f "$TEST_FILE" ]; then
    echo "▶ $TEST_FILE"
    echo "  ⊘ SKIPPED: file not found"
    echo ""
    continue
  fi

  echo "▶ $TEST_FILE"
  echo "----------------------------------------"

  # Run the test and capture output
  OUTPUT=$(node --test "$TEST_FILE" 2>&1)
  EXIT_CODE=$?

  # Parse pass/fail counts from test summary (ℹ pass N / ℹ fail N)
  PASS=$(echo "$OUTPUT" | grep -o 'ℹ pass [0-9]*' | grep -o '[0-9]*' | head -1)
  FAIL=$(echo "$OUTPUT" | grep -o 'ℹ fail [0-9]*' | grep -o '[0-9]*' | head -1)
  PASS=${PASS:-0}
  FAIL=${FAIL:-0}

  # If exit code non-zero but no fail count parsed, count as 1 failure
  if [ "$EXIT_CODE" -ne 0 ] && [ "$FAIL" -eq 0 ]; then
    FAIL=1
  fi

  TOTAL_PASS=$((TOTAL_PASS + PASS))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL))

  if [ "$FAIL" -gt 0 ]; then
    echo "  ✖ FAILED: $PASS passed, $FAIL failed"
    # Extract failing test names (lines with "not ok")
    while IFS= read -r line; do
      # Clean up the TAP "not ok" line to get test name
      TEST_NAME=$(echo "$line" | sed 's/^not ok [0-9]* - //')
      FAILED_TESTS+=("$TEST_NAME ($TEST_FILE)")
      echo "    ✖ $TEST_NAME"
    done < <(echo "$OUTPUT" | grep "^not ok")
  else
    echo "  ✔ PASSED: $PASS tests"
  fi
  echo ""
done

echo "========================================"
echo " TEST SUMMARY"
echo "========================================"
echo " Total: $((TOTAL_PASS + TOTAL_FAIL)) | Passed: $TOTAL_PASS | Failed: $TOTAL_FAIL"
echo ""

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo "FAILED TESTS:"
  for t in "${FAILED_TESTS[@]}"; do
    echo "  ✖ $t"
  done
  echo ""
fi

echo "========================================"

[ "$TOTAL_FAIL" -eq 0 ]
