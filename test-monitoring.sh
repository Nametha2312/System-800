#!/bin/bash
# Get token
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"debug@test.com","password":"Debug@12345"}' | jq -r '.data.token')

echo "Token: ${TOKEN:0:20}..."

# Wait a moment
sleep 2

# Test monitoring start
echo ""
echo "Testing monitoring start..."
curl -s -X POST "http://localhost:4000/api/v1/skus/15497813-2d63-4e96-b507-c10888cfe8d5/monitoring/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
