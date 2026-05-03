#!/usr/bin/env bash
# ============================================================
#  Testeur de jobs en masse — Revolution API
#  Usage: bash test_jobs.sh <API_KEY>
# ============================================================

API_KEY="${1:-}"
BASE_URL="https://revolution-backend-sal2.onrender.com/api/enterprise/v1"
POLL_INTERVAL=3
TIMEOUT=180
DELAY=1
RESULTS_FILE="job_results_$(date +%Y%m%d_%H%M%S).json"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

if [ -z "$API_KEY" ]; then
  echo -e "${RED}Usage: bash test_jobs.sh <API_KEY>${RESET}"
  exit 1
fi

# ---- Payloads (validés par tests) ----------------------------
declare -A JOBS

# ✅ Validé
JOBS["http_get"]='{"type":"http_get","params":{"url":"https://httpbin.org/get"}}'

# ✅ Validé
JOBS["text_transform"]='{"type":"text_transform","params":{"text":"Le renard brun rapide saute par-dessus le chien paresseux.","transform":"uppercase"}}'

# ✅ Validé
JOBS["text_generate_template"]='{"type":"text_generate_template","params":{"template":"Bonjour {{name}}, commande {{order_id}} confirmee.","variables":{"name":"Alice","order_id":"CMD-4821"}}}'

# ✅ Validé — pas de "return", juste une expression
JOBS["code_run_js"]='{"type":"code_run_js","params":{"code":"JSON.stringify({sum:[1,2,3,4,5].reduce((a,b)=>a+b,0),square:7*7,hello:\"world\"})"}}'

# ✅ Validé
JOBS["scrape_get"]='{"type":"scrape_get","params":{"url":"https://news.ycombinator.com","mode":"auto","extract":["title","links"]}}'

# ✅ Validé
JOBS["image_svg_generate"]='{"type":"image_svg_generate","params":{"prompt":"A minimalist blue mountain landscape with a yellow sun","width":400,"height":300}}'

# ✅ Validé — utilise url (pas text)
JOBS["content_check"]='{"type":"content_check","params":{"url":"https://httpbin.org/get"}}'

# ✅ Validé
JOBS["csv_stats"]='{"type":"csv_stats","params":{"url":"https://raw.githubusercontent.com/plotly/datasets/master/iris.csv"}}'

# ✅ Validé
JOBS["ocr_pdf"]='{"type":"ocr_pdf","params":{"url":"https://www.w3.org/WAI/WCAG21/Techniques/pdf/sample.pdf"}}'

# ✅ Validé — inputUrl (pas url), sans duration_limit
JOBS["audio_convert"]='{"type":"audio_convert","params":{"inputUrl":"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3","format":"mp3"}}'

# ✅ Validé — crypto_scrape fonctionne
JOBS["crypto_scrape"]='{"type":"crypto_scrape","params":{"symbol":"BTC"}}'

JOB_ORDER=(
  http_get
  text_transform
  text_generate_template
  code_run_js
  scrape_get
  image_svg_generate
  content_check
  csv_stats
  ocr_pdf
  audio_convert
  crypto_scrape
)

# ---- Helpers -------------------------------------------------
post_job() {
  curl -s -X POST "${BASE_URL}/jobs" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${API_KEY}" \
    -d "$1"
}

get_result() {
  curl -s "${BASE_URL}/jobs/${1}/result" -H "x-api-key: ${API_KEY}"
}

extract_id() {
  local val
  val=$(echo "$1" | sed -n 's/.*"job_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  [ -z "$val" ] && val=$(echo "$1" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
  echo "$val"
}

extract_status() {
  echo "$1" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

poll_job() {
  local job_id="$1" job_type="$2" elapsed=0 result status
  while [ $elapsed -lt $TIMEOUT ]; do
    sleep $POLL_INTERVAL
    elapsed=$((elapsed + POLL_INTERVAL))
    result=$(get_result "$job_id")
    status=$(extract_status "$result")
    if [ "$status" = "done" ] || [ "$status" = "completed" ]; then
      echo -e " ${GREEN}✓ done${RESET} (${elapsed}s)"
      echo "$result" > "/tmp/job_out_${job_type}.json"
      return 0
    elif [ "$status" = "error" ] || [ "$status" = "failed" ]; then
      local err
      err=$(echo "$result" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | cut -c1-80)
      echo -e " ${RED}✗ error${RESET} — $err"
      echo "$result" > "/tmp/job_out_${job_type}.json"
      return 1
    else
      printf "."
    fi
  done
  echo -e " ${YELLOW}⏱ timeout${RESET} (${TIMEOUT}s)"
  return 2
}

# ---- Header --------------------------------------------------
echo ""
echo -e "${BOLD}================================================${RESET}"
echo -e "${BOLD}   Revolution API — Test de jobs en masse${RESET}"
echo -e "${BOLD}================================================${RESET}"
echo -e "Base URL : ${CYAN}${BASE_URL}${RESET}"
echo -e "Jobs     : ${#JOB_ORDER[@]} types"
echo -e "Timeout  : ${TIMEOUT}s / job"
echo ""

echo "[" > "$RESULTS_FILE"
first_entry=true
SUCCESS=0; FAILURE=0; TOTAL=0

for job_type in "${JOB_ORDER[@]}"; do
  TOTAL=$((TOTAL + 1))
  payload="${JOBS[$job_type]}"
  printf "${BOLD}%-28s${RESET} " "$job_type"

  response=$(post_job "$payload")
  job_id=$(extract_id "$response")

  if [ -z "$job_id" ]; then
    err=$(echo "$response" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    echo -e "${RED}✗ Pas d'id${RESET} — ${err:-$response}"
    FAILURE=$((FAILURE + 1))
    [ "$first_entry" = false ] && echo "," >> "$RESULTS_FILE"
    first_entry=false
    printf '{"type":"%s","status":"error","error":"no id returned"}\n' "$job_type" >> "$RESULTS_FILE"
    sleep $DELAY; continue
  fi

  printf "id=%-6s " "$job_id"

  if poll_job "$job_id" "$job_type"; then
    SUCCESS=$((SUCCESS + 1))
    result_data=$(cat "/tmp/job_out_${job_type}.json" 2>/dev/null || echo '{}')
    [ "$first_entry" = false ] && echo "," >> "$RESULTS_FILE"
    first_entry=false
    printf '{"type":"%s","status":"done","id":%s,"result":%s}\n' "$job_type" "$job_id" "$result_data" >> "$RESULTS_FILE"
  else
    FAILURE=$((FAILURE + 1))
    result_data=$(cat "/tmp/job_out_${job_type}.json" 2>/dev/null || echo '{}')
    [ "$first_entry" = false ] && echo "," >> "$RESULTS_FILE"
    first_entry=false
    printf '{"type":"%s","status":"error","id":%s,"result":%s}\n' "$job_type" "$job_id" "$result_data" >> "$RESULTS_FILE"
  fi

  rm -f "/tmp/job_out_${job_type}.json"
  sleep $DELAY
done

echo "]" >> "$RESULTS_FILE"

echo ""
echo -e "${BOLD}================================================${RESET}"
echo -e " ${GREEN}${SUCCESS} reussis${RESET} / ${RED}${FAILURE} echoues${RESET} / ${TOTAL} total"
echo -e " Rapport : ${CYAN}${RESULTS_FILE}${RESET}"
echo -e "${BOLD}================================================${RESET}"
echo ""
