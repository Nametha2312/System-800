import requests
import json

BASE_URL = "http://localhost:4000/api/v1"

# Login
login_response = requests.post(f"{BASE_URL}/auth/login", json={
    "email": "debug@test.com",
    "password": "Debug@12345"
})
print(f"Login status: {login_response.status_code}")

if login_response.status_code != 200:
    print(f"Login failed: {login_response.text}")
    exit(1)

login_data = login_response.json()
token = login_data.get("data", {}).get("accessToken")
if not token:
    print("Could not find accessToken in response")
    exit(1)
print(f"✅ Token received")

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Test monitoring start
sku_id = "15497813-2d63-4e96-b507-c10888cfe8d5"
monitoring_response = requests.post(f"{BASE_URL}/skus/{sku_id}/monitoring/start", headers=headers)

print(f"\nMonitoring start status: {monitoring_response.status_code}")
print(f"Response: {json.dumps(monitoring_response.json(), indent=2)}")

# Check if error contains scheduling info
if monitoring_response.status_code == 200:
    print("\n✅ SUCCESS: Monitoring started successfully!")
else:
    print(f"\n❌ Failed with status {monitoring_response.status_code}")
