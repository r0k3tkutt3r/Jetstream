#!/usr/bin/env bash
# Echoes a small canned stream-json transcript then waits on stdin.
set -e
cat <<'EOF'
{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-000000000001","cwd":"/tmp"}
{"type":"assistant","message":{"id":"msg_01","role":"assistant","content":[{"type":"text","text":""}]}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}},"parent_message_id":"msg_01"}
{"type":"result","subtype":"success","is_error":false,"duration_ms":10,"duration_api_ms":10,"num_turns":1,"total_cost_usd":0.0,"usage":{"input_tokens":1,"output_tokens":1}}
EOF
# Stay alive, mirroring real claude -p with --input-format stream-json
while IFS= read -r line; do
  case "$line" in
    *exit*) exit 0 ;;
  esac
done
