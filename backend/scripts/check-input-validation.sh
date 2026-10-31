#!/bin/bash
# Sends malformed and hostile requests to a running backend and fails if any of them
# produces a 5xx. A client mistake must always be a 4xx with a clear error code.
#
#   cd backend && npm run dev          # in one terminal
#   ./scripts/check-input-validation.sh [host:port]    # in another (default localhost:4000)
#
# Every case is rejected before any call to the Stellar network, so this works offline.
# The backend needs ESCROW_CONTRACT_ID set (any valid contract id) so the order routes exist.
# Until the backend has a test runner (#10), run this after changing request validation.

HOST=${1:-localhost:4000}
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

# Syntactically valid public addresses (the demo accounts from ./setup.sh).
B=GBKXCOYK6ITIUKJHJVVDUVEWZRWGAYMDRVTQQQK2HHALDYKCV66EL3MC
F=GBJVOAZGITFHHNITKEBZFJXQO6I45XDF37ISY6L7K3XRNTC7X7E77UCI
C=GBPDUSWCRGZZUPY5EHZRXJXVQTBM3DDLKNTCZK5BJOPH5AN4DRZF5AHJ
CONTRACT=CBEZZ7PQPDQWRMZUSBI3CPB55RDPLIUF2D4NLMFKXKQO4CNAOG34OGKS
FAILED=0
TOTAL=0

# check <description> <path> <json body> <expected error code>
check() {
  local code error
  TOTAL=$((TOTAL + 1))
  code=$(curl -s -m 30 -o "$OUT" -w "%{http_code}" -X POST "$HOST$2" -H 'content-type: application/json' -d "$3")
  error=$(python3 -c "import json; print(json.load(open('$OUT')).get('error', {}).get('code', 'none'))" 2>/dev/null || echo "not-json")
  if [[ "$code" == 4* && "$error" == "$4" ]]; then
    printf "ok    %-4s %-20s %s\n" "$code" "$error" "$1"
  else
    printf "FAIL  %-4s %-20s %s (expected 4xx %s)\n" "$code" "$error" "$1" "$4"
    FAILED=$((FAILED + 1))
  fi
}

# order <amount> [deadline] [review window hours] [dispute window days: omit for the default]
order() { echo "{\"buyer\":\"$B\",\"farmer\":\"$F\",\"arbiter\":\"$C\",\"amount\":\"$1\",\"deliveryDeadline\":\"${2:-2030-01-01T00:00:00Z}\",\"reviewWindowHours\":${3:-72}${4:+,\"disputeWindowDays\":$4}}"; }

echo "Create order"
check "amount over the i128 limit"            /api/orders "$(order 170141183460469231731687303715884105728)" INVALID_AMOUNT
check "amount with 41 digits"                 /api/orders "$(order 99999999999999999999999999999999999999999)" INVALID_AMOUNT
check "amount in scientific notation"         /api/orders "$(order 1e5)" INVALID_AMOUNT
check "amount with 8 decimals"                /api/orders "$(order 1.12345678)" INVALID_AMOUNT
check "amount is a number, not a string"      /api/orders "{\"buyer\":\"$B\",\"farmer\":\"$F\",\"arbiter\":\"$C\",\"amount\":100,\"deliveryDeadline\":\"2030-01-01T00:00:00Z\",\"reviewWindowHours\":72}" MISSING_FIELD
check "review window overflows u64"           /api/orders "$(order 100 2030-01-01T00:00:00Z 10000000000000000)" INVALID_DEADLINE
check "review window is fractional"           /api/orders "$(order 100 2030-01-01T00:00:00Z 1.5)" INVALID_DEADLINE
check "review window is zero"                 /api/orders "$(order 100 2030-01-01T00:00:00Z 0)" INVALID_DEADLINE
check "review window is a string"             /api/orders "$(order 100 2030-01-01T00:00:00Z '"72"')" INVALID_DEADLINE
check "dispute window is zero"                /api/orders "$(order 100 2030-01-01T00:00:00Z 72 0)" INVALID_DEADLINE
check "dispute window is over 30 days"       /api/orders "$(order 100 2030-01-01T00:00:00Z 72 31)" INVALID_DEADLINE
check "dispute window is fractional"          /api/orders "$(order 100 2030-01-01T00:00:00Z 72 1.5)" INVALID_DEADLINE
check "dispute window is a string"            /api/orders "$(order 100 2030-01-01T00:00:00Z 72 '"7"')" INVALID_DEADLINE
check "dispute window overflows u64"          /api/orders "$(order 100 2030-01-01T00:00:00Z 72 10000000000000000)" INVALID_DEADLINE
check "deadline in the past (1960)"           /api/orders "$(order 100 1960-01-01T00:00:00Z)" INVALID_DEADLINE
check "deadline is not a date"                /api/orders "$(order 100 tomorrow)" INVALID_DEADLINE
check "buyer is a contract id"                /api/orders "{\"buyer\":\"$CONTRACT\",\"farmer\":\"$F\",\"arbiter\":\"$C\",\"amount\":\"100\",\"deliveryDeadline\":\"2030-01-01T00:00:00Z\",\"reviewWindowHours\":72}" INVALID_ADDRESS
check "body is an array"                      /api/orders '[1,2,3]' INVALID_BODY
check "body is null"                          /api/orders 'null' INVALID_JSON

echo "Order actions"
check "order id over the u64 limit"           /api/orders/18446744073709551616/accept '{}' INVALID_ORDER_ID
check "order id is huge"                      /api/orders/99999999999999999999999999/accept '{}' INVALID_ORDER_ID
check "order id is not a number"              /api/orders/abc/accept '{}' INVALID_ORDER_ID
check "dispute reason is a number"            /api/orders/1/dispute '{"reason":12345}' MISSING_FIELD
check "dispute reason is empty"               /api/orders/1/dispute '{"reason":""}' MISSING_FIELD
check "dispute reason is 90 KB"               /api/orders/1/dispute "{\"reason\":\"$(head -c 90000 /dev/zero | tr '\0' 'a')\"}" INVALID_REASON
check "resolve amount is negative"            /api/orders/1/resolve '{"farmerAmount":"-5"}' INVALID_AMOUNT
check "resolve amount is not a number"        /api/orders/1/resolve '{"farmerAmount":"abc"}' INVALID_AMOUNT
check "resolve amount over the i128 limit"    /api/orders/1/resolve '{"farmerAmount":"99999999999999999999999999999999999999999"}' INVALID_AMOUNT
check "claim caller is not an address"        /api/orders/1/claim '{"caller":"nope"}' INVALID_ADDRESS
check "expire caller is not an address"       /api/orders/1/expire '{"caller":"nope"}' INVALID_ADDRESS

echo "Submit"
check "signedXdr is garbage"                  /api/transactions '{"signedXdr":"AAAA"}' INVALID_TRANSACTION
check "signedXdr is an object"                /api/transactions '{"signedXdr":{"a":1}}' MISSING_FIELD
check "signedXdr is empty"                    /api/transactions '{"signedXdr":""}' MISSING_FIELD

echo
echo "$((TOTAL - FAILED))/$TOTAL checks passed"
[ "$FAILED" -eq 0 ]
