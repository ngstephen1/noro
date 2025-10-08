### Summarize
API="https://<your-api-id>.execute-api.us-east-1.amazonaws.com"
curl -s -X POST "$API/summarize" -H 'Content-Type: application/json' -d '{
  "userId":"dev",
  "windowMinutes":8,
  "snapshots":[{"t":1738922000000,"url":"https://docs.google.com/document/","app":"gdocs","signals":{"title":"Demo Doc","headingPath":["Testing","UAT"],"cursorText":"Finalize UAT…"}}]
}' | jq



### Snapshot
curl -s -X POST "$API/snapshot" -H 'Content-Type: application/json' -d '{
  "userId":"dev",
  "snapshot":{"t":1738922100000,"url":"https://docs.google.com/","app":"gdocs","signals":{"title":"Demo"}}
}' | jq