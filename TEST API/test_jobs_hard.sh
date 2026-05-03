#!/usr/bin/env bash
# ============================================================
#  Revolution API — HARD STRESS TEST
#  Usage: bash test_jobs_hard.sh <API_KEY> [MODE] [CONCURRENCY]
#
#  MODE        : sequential | parallel | chaos | full (défaut: full)
#  CONCURRENCY : nb jobs en parallèle (défaut: 5)
#
#  Exemples:
#    bash test_jobs_hard.sh MY_KEY full 10
#    bash test_jobs_hard.sh MY_KEY chaos
#    bash test_jobs_hard.sh MY_KEY parallel 20
# ============================================================

API_KEY="${1:-}"
MODE="${2:-full}"
CONCURRENCY="${3:-5}"

BASE_URL="https://revolution-backend-sal2.onrender.com/api/enterprise/v1"
POLL_INTERVAL=2
TIMEOUT=180
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULTS_FILE="hard_results_${MODE}_${TIMESTAMP}.json"
REPORT_FILE="hard_report_${MODE}_${TIMESTAMP}.txt"
TMP_DIR="/tmp/rev_hard_$$"
mkdir -p "$TMP_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; MAGENTA='\033[0;35m'; BOLD='\033[1m'; RESET='\033[0m'
BLUE='\033[0;34m'

if [ -z "$API_KEY" ]; then
  echo -e "${RED}Usage: bash test_jobs_hard.sh <API_KEY> [MODE] [CONCURRENCY]${RESET}"
  echo -e "  MODE : sequential | parallel | chaos | full"
  exit 1
fi

# ============================================================
#  PAYLOADS VALIDES
# ============================================================
declare -A VALID_JOBS

VALID_JOBS["http_get"]='{"type":"http_get","params":{"url":"https://httpbin.org/get"}}'
VALID_JOBS["text_transform"]='{"type":"text_transform","params":{"text":"Le renard brun rapide saute par-dessus le chien paresseux.","transform":"uppercase"}}'
VALID_JOBS["text_generate_template"]='{"type":"text_generate_template","params":{"template":"Bonjour {{name}}, commande {{order_id}} confirmee.","variables":{"name":"Alice","order_id":"CMD-4821"}}}'
VALID_JOBS["code_run_js"]='{"type":"code_run_js","params":{"code":"JSON.stringify({sum:[1,2,3,4,5].reduce((a,b)=>a+b,0),square:7*7,hello:\"world\"})"}}'
VALID_JOBS["scrape_get"]='{"type":"scrape_get","params":{"url":"https://news.ycombinator.com","mode":"auto","extract":["title","links"]}}'
VALID_JOBS["image_svg_generate"]='{"type":"image_svg_generate","params":{"prompt":"A minimalist blue mountain landscape with a yellow sun","width":400,"height":300}}'
VALID_JOBS["content_check"]='{"type":"content_check","params":{"url":"https://httpbin.org/get"}}'
VALID_JOBS["csv_stats"]='{"type":"csv_stats","params":{"url":"https://raw.githubusercontent.com/plotly/datasets/master/iris.csv"}}'
VALID_JOBS["ocr_pdf"]='{"type":"ocr_pdf","params":{"url":"https://www.w3.org/WAI/WCAG21/Techniques/pdf/sample.pdf"}}'
VALID_JOBS["audio_convert"]='{"type":"audio_convert","params":{"inputUrl":"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3","format":"mp3"}}'
VALID_JOBS["crypto_scrape"]='{"type":"crypto_scrape","params":{"symbol":"BTC"}}'

VALID_ORDER=(http_get text_transform text_generate_template code_run_js scrape_get image_svg_generate content_check csv_stats ocr_pdf audio_convert crypto_scrape)

# ============================================================
#  PAYLOADS CHAOS (intentionnellement cassés)
# ============================================================
declare -A CHAOS_JOBS

# Mauvais type
CHAOS_JOBS["chaos_bad_type"]='{"type":"does_not_exist","params":{}}'
# URL invalide
CHAOS_JOBS["chaos_bad_url"]='{"type":"http_get","params":{"url":"not-a-url"}}'
# Paramètre manquant
CHAOS_JOBS["chaos_missing_param"]='{"type":"text_transform","params":{"transform":"uppercase"}}'
# Payload vide
CHAOS_JOBS["chaos_empty_params"]='{"type":"csv_stats","params":{}}'
# URL morte
CHAOS_JOBS["chaos_dead_url"]='{"type":"scrape_get","params":{"url":"https://this-domain-does-not-exist-xyz.com","mode":"auto"}}'
# JS invalide (erreur runtime)
CHAOS_JOBS["chaos_bad_js"]='{"type":"code_run_js","params":{"code":"undefinedVariable.toString()"}}'
# Très grand payload texte (> 500 000 chars = dépasse la limite backend)
_HUGE_TEXT=$(python3 -c "print('A'*600001)")
CHAOS_JOBS["chaos_huge_text"]="{\"type\":\"text_transform\",\"params\":{\"text\":\"${_HUGE_TEXT}\",\"transform\":\"uppercase\"}}"

CHAOS_ORDER=(chaos_bad_type chaos_bad_url chaos_missing_param chaos_empty_params chaos_dead_url chaos_bad_js chaos_huge_text)

# ============================================================
#  HELPERS
# ============================================================
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

now_ms() {
  # millisecondes epoch
  date +%s%3N 2>/dev/null || echo $(($(date +%s) * 1000))
}

# Poll un job, écrit résultat dans $TMP_DIR/<label>.json
# Retourne: 0=success 1=error 2=timeout
# Écrit aussi: $TMP_DIR/<label>.meta  (label|id|status|elapsed_ms|error)
poll_and_record() {
  local job_id="$1" label="$2" start_ms="$3"
  local elapsed_poll=0 result status

  while [ $elapsed_poll -lt $TIMEOUT ]; do
    sleep $POLL_INTERVAL
    elapsed_poll=$((elapsed_poll + POLL_INTERVAL))
    result=$(get_result "$job_id")
    status=$(extract_status "$result")

    if [ "$status" = "done" ] || [ "$status" = "completed" ]; then
      local end_ms elapsed_ms
      end_ms=$(now_ms)
      elapsed_ms=$((end_ms - start_ms))
      echo "$result" > "${TMP_DIR}/${label}.json"
      echo "${label}|${job_id}|success|${elapsed_ms}|" > "${TMP_DIR}/${label}.meta"
      return 0
    elif [ "$status" = "error" ] || [ "$status" = "failed" ]; then
      local err end_ms elapsed_ms
      err=$(echo "$result" | sed -n 's/.*"error"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | cut -c1-100)
      end_ms=$(now_ms)
      elapsed_ms=$((end_ms - start_ms))
      echo "$result" > "${TMP_DIR}/${label}.json"
      echo "${label}|${job_id}|error|${elapsed_ms}|${err}" > "${TMP_DIR}/${label}.meta"
      return 1
    fi
  done

  local end_ms elapsed_ms
  end_ms=$(now_ms)
  elapsed_ms=$((end_ms - start_ms))
  echo "{}" > "${TMP_DIR}/${label}.json"
  echo "${label}|${job_id}|timeout|${elapsed_ms}|timeout after ${TIMEOUT}s" > "${TMP_DIR}/${label}.meta"
  return 2
}

# Lance un job complet (post + poll) en arrière-plan
run_job_bg() {
  local job_type="$1" label="$2" payload="$3"
  local start_ms
  start_ms=$(now_ms)

  response=$(post_job "$payload")
  job_id=$(extract_id "$response")

  if [ -z "$job_id" ]; then
    local err
    err=$(echo "$response" | sed -n 's/.*"message"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    echo "${label}|0|no_id|0|${err:-no id in response}" > "${TMP_DIR}/${label}.meta"
    echo '{}' > "${TMP_DIR}/${label}.json"
    return 1
  fi

  echo "${job_id}" > "${TMP_DIR}/${label}.id"
  poll_and_record "$job_id" "$label" "$start_ms"
}

# ============================================================
#  AFFICHAGE LIVE (lit les .meta au fur et à mesure)
# ============================================================
print_live_result() {
  local label="$1"
  local meta_file="${TMP_DIR}/${label}.meta"
  local waited=0

  while [ ! -f "$meta_file" ] && [ $waited -lt $((TIMEOUT + 30)) ]; do
    sleep 1; waited=$((waited + 1))
  done

  if [ ! -f "$meta_file" ]; then
    echo -e "  ${RED}✗${RESET} ${label} — pas de résultat (timeout watcher)"
    return
  fi

  IFS='|' read -r lbl jid status elapsed_ms err < "$meta_file"
  local elapsed_s=$(( (elapsed_ms + 500) / 1000 ))

  case "$status" in
    success)
      echo -e "  ${GREEN}✓${RESET} ${BOLD}${lbl}${RESET} id=${jid} — ${GREEN}done${RESET} (${elapsed_s}s)"
      ;;
    error)
      echo -e "  ${RED}✗${RESET} ${BOLD}${lbl}${RESET} id=${jid} — ${RED}error${RESET}: ${err} (${elapsed_s}s)"
      ;;
    timeout)
      echo -e "  ${YELLOW}⏱${RESET} ${BOLD}${lbl}${RESET} id=${jid} — ${YELLOW}timeout${RESET} (${TIMEOUT}s)"
      ;;
    no_id)
      echo -e "  ${RED}✗${RESET} ${BOLD}${lbl}${RESET} — ${RED}pas d'id${RESET}: ${err}"
      ;;
    *)
      echo -e "  ${YELLOW}?${RESET} ${BOLD}${lbl}${RESET} — statut inconnu: ${status}"
      ;;
  esac
}

# ============================================================
#  STATS FINALES
# ============================================================
compute_stats() {
  local meta_files=("${TMP_DIR}"/*.meta)
  local total=0 success=0 error=0 timeout=0 no_id=0
  local sum_ms=0 min_ms=999999999 max_ms=0
  local latencies=()

  for f in "${meta_files[@]}"; do
    [ -f "$f" ] || continue
    IFS='|' read -r lbl jid status elapsed_ms err < "$f"
    total=$((total + 1))
    case "$status" in
      success) success=$((success + 1)) ;;
      error)   error=$((error + 1)) ;;
      timeout) timeout=$((timeout + 1)) ;;
      no_id)   no_id=$((no_id + 1)) ;;
    esac
    if [ "$elapsed_ms" -gt 0 ] 2>/dev/null && [ "$status" != "no_id" ]; then
      sum_ms=$((sum_ms + elapsed_ms))
      latencies+=($elapsed_ms)
      [ "$elapsed_ms" -lt "$min_ms" ] && min_ms=$elapsed_ms
      [ "$elapsed_ms" -gt "$max_ms" ] && max_ms=$elapsed_ms
    fi
  done

  local avg_ms=0
  [ ${#latencies[@]} -gt 0 ] && avg_ms=$((sum_ms / ${#latencies[@]}))

  # Tri pour p50/p95/p99
  local sorted_latencies p50_ms=0 p95_ms=0 p99_ms=0
  if [ ${#latencies[@]} -gt 0 ]; then
    IFS=$'\n' sorted_latencies=($(printf '%s\n' "${latencies[@]}" | sort -n))
    local n=${#sorted_latencies[@]}
    local idx50=$(( (n * 50) / 100 ))
    local idx95=$(( (n * 95) / 100 ))
    local idx99=$(( (n * 99) / 100 ))
    [ $idx50 -ge $n ] && idx50=$((n - 1))
    [ $idx95 -ge $n ] && idx95=$((n - 1))
    [ $idx99 -ge $n ] && idx99=$((n - 1))
    p50_ms=${sorted_latencies[$idx50]}
    p95_ms=${sorted_latencies[$idx95]}
    p99_ms=${sorted_latencies[$idx99]}
  fi

  # Écriture dans un fichier pour éviter les conflits IFS avec les valeurs
  cat > "${TMP_DIR}/stats.env" <<EOF
STAT_TOTAL=${total}
STAT_SUCCESS=${success}
STAT_ERROR=${error}
STAT_TIMEOUT=${timeout}
STAT_NOID=${no_id}
STAT_AVG=${avg_ms}
STAT_MIN=${min_ms}
STAT_MAX=${max_ms}
STAT_P50=${p50_ms}
STAT_P95=${p95_ms}
STAT_P99=${p99_ms}
EOF
}

# ============================================================
#  BUILD JSON RAPPORT
# ============================================================
build_json() {
  echo "[" > "$RESULTS_FILE"
  local first=true
  for f in "${TMP_DIR}"/*.meta; do
    [ -f "$f" ] || continue
    IFS='|' read -r lbl jid status elapsed_ms err < "$f"
    local result_json
    result_json=$(cat "${TMP_DIR}/${lbl}.json" 2>/dev/null || echo '{}')
    [ "$first" = false ] && echo "," >> "$RESULTS_FILE"
    first=false
    printf '{"label":"%s","job_id":%s,"status":"%s","elapsed_ms":%s,"error":"%s","result":%s}\n' \
      "$lbl" "${jid:-0}" "$status" "${elapsed_ms:-0}" "${err}" "$result_json" >> "$RESULTS_FILE"
  done
  echo "]" >> "$RESULTS_FILE"
}

# ============================================================
#  MODE : SEQUENTIAL (baseline propre avec métriques)
# ============================================================
run_sequential() {
  echo -e "\n${BOLD}${CYAN}[ MODE SEQUENTIAL — ${#VALID_ORDER[@]} jobs, un par un ]${RESET}"
  echo -e "Mesure la latence baseline de chaque type de job\n"

  for job_type in "${VALID_ORDER[@]}"; do
    local label="seq_${job_type}"
    printf "  ${BOLD}%-32s${RESET} " "$job_type"
    run_job_bg "$job_type" "$label" "${VALID_JOBS[$job_type]}"
    print_live_result "$label" &
    wait
  done
}

# ============================================================
#  MODE : PARALLEL (charge concurrente)
# ============================================================
run_parallel() {
  local concurrency="${1:-$CONCURRENCY}"
  echo -e "\n${BOLD}${MAGENTA}[ MODE PARALLEL — concurrence x${concurrency} ]${RESET}"
  echo -e "Lance ${concurrency} jobs simultanément et mesure la dégradation\n"

  local pids=() labels=()
  local count=0

  for job_type in "${VALID_ORDER[@]}"; do
    local label="par_${count}_${job_type}"
    labels+=("$label")

    run_job_bg "$job_type" "$label" "${VALID_JOBS[$job_type]}" &
    pids+=($!)
    count=$((count + 1))

    # Attendre si on atteint la concurrence max
    if [ ${#pids[@]} -ge "$concurrency" ]; then
      echo -e "  ${BLUE}→ Batch de ${#pids[@]} jobs envoyés, attente...${RESET}"
      for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
      for lbl in "${labels[@]}"; do print_live_result "$lbl"; done
      pids=(); labels=()
    fi
  done

  # Dernier batch
  if [ ${#pids[@]} -gt 0 ]; then
    echo -e "  ${BLUE}→ Batch final de ${#pids[@]} jobs, attente...${RESET}"
    for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
    for lbl in "${labels[@]}"; do print_live_result "$lbl"; done
  fi
}

# ============================================================
#  MODE : PARALLEL HEAVY (vrai stress — N fois tous les jobs)
# ============================================================
run_parallel_heavy() {
  local concurrency="${1:-$CONCURRENCY}"
  local rounds=3  # 3 vagues = 33 jobs si 11 types
  echo -e "\n${BOLD}${MAGENTA}[ MODE PARALLEL HEAVY — ${rounds} vagues x ${#VALID_ORDER[@]} jobs, concurrence x${concurrency} ]${RESET}"
  echo -e "Total: $((rounds * ${#VALID_ORDER[@]})) jobs\n"

  local pids=() labels=() total_sent=0

  for round in $(seq 1 $rounds); do
    echo -e "\n  ${BLUE}— Vague ${round}/${rounds} —${RESET}"
    for job_type in "${VALID_ORDER[@]}"; do
      local label="heavy_r${round}_${job_type}"
      labels+=("$label")
      run_job_bg "$job_type" "$label" "${VALID_JOBS[$job_type]}" &
      pids+=($!)
      total_sent=$((total_sent + 1))

      if [ ${#pids[@]} -ge "$concurrency" ]; then
        for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
        for lbl in "${labels[@]}"; do print_live_result "$lbl"; done
        pids=(); labels=()
      fi
    done
  done

  if [ ${#pids[@]} -gt 0 ]; then
    for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
    for lbl in "${labels[@]}"; do print_live_result "$lbl"; done
  fi
}

# ============================================================
#  MODE : CHAOS (payloads cassés volontairement)
# ============================================================
run_chaos() {
  echo -e "\n${BOLD}${RED}[ MODE CHAOS — ${#CHAOS_ORDER[@]} payloads invalides ]${RESET}"
  echo -e "Vérifie que l'API gère proprement les erreurs sans planter\n"

  local pids=() labels=()

  for job_type in "${CHAOS_ORDER[@]}"; do
    local label="chaos_${job_type}"
    labels+=("$label")
    run_job_bg "$job_type" "$label" "${CHAOS_JOBS[$job_type]}" &
    pids+=($!)
  done

  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done

  echo -e "\n  ${BOLD}Résultats chaos (on attend des erreurs propres) :${RESET}"
  for lbl in "${labels[@]}"; do print_live_result "$lbl"; done

  # Analyse : un chaos qui revient "success" est un bug
  echo ""
  for lbl in "${labels[@]}"; do
    local meta="${TMP_DIR}/${lbl}.meta"
    [ -f "$meta" ] || continue
    IFS='|' read -r l jid status elapsed_ms err < "$meta"
    if [ "$status" = "success" ]; then
      echo -e "  ${YELLOW}⚠ ATTENTION:${RESET} ${lbl} a retourné SUCCESS sur un payload invalide → bug potentiel"
    fi
  done
}

# ============================================================
#  HEADER
# ============================================================
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     Revolution API — HARD STRESS TEST            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo -e "  Base URL    : ${CYAN}${BASE_URL}${RESET}"
echo -e "  Mode        : ${BOLD}${MODE}${RESET}"
echo -e "  Concurrence : ${BOLD}${CONCURRENCY}${RESET}"
echo -e "  Timestamp   : ${TIMESTAMP}"
echo ""

GLOBAL_START=$(now_ms)

# ============================================================
#  DISPATCH DES MODES
# ============================================================
case "$MODE" in
  sequential)
    run_sequential
    ;;
  parallel)
    run_parallel "$CONCURRENCY"
    ;;
  heavy)
    run_parallel_heavy "$CONCURRENCY"
    ;;
  chaos)
    run_chaos
    ;;
  full)
    run_sequential
    echo ""
    run_parallel "$CONCURRENCY"
    echo ""
    run_chaos
    echo ""
    run_parallel_heavy "$CONCURRENCY"
    ;;
  *)
    echo -e "${RED}Mode inconnu: ${MODE}. Choix: sequential | parallel | heavy | chaos | full${RESET}"
    exit 1
    ;;
esac

GLOBAL_END=$(now_ms)
GLOBAL_ELAPSED=$(( (GLOBAL_END - GLOBAL_START) / 1000 ))

# ============================================================
#  RAPPORT FINAL
# ============================================================
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║                RAPPORT FINAL                     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"

compute_stats
source "${TMP_DIR}/stats.env"
t_total=$STAT_TOTAL; t_success=$STAT_SUCCESS; t_error=$STAT_ERROR
t_timeout=$STAT_TIMEOUT; t_noid=$STAT_NOID
avg=$STAT_AVG; min=$STAT_MIN; max=$STAT_MAX
p50=$STAT_P50; p95=$STAT_P95; p99=$STAT_P99

echo -e ""
echo -e "  ${BOLD}Volume${RESET}"
echo -e "    Total      : ${BOLD}${t_total}${RESET} jobs"
echo -e "    Succès     : ${GREEN}${t_success}${RESET}"
echo -e "    Erreurs    : ${RED}${t_error}${RESET}"
echo -e "    Timeouts   : ${YELLOW}${t_timeout}${RESET}"
echo -e "    No-ID      : ${RED}${t_noid}${RESET}"

if [ "$t_total" -gt 0 ]; then
  local_success_rate=$(( (t_success * 100) / t_total ))
  echo -e "    Taux succès: ${BOLD}${local_success_rate}%${RESET}"
fi

echo -e ""
echo -e "  ${BOLD}Latences (ms)${RESET}"
echo -e "    Moyenne    : ${avg}ms  ($(( avg / 1000 ))s)"
echo -e "    Min        : ${min}ms"
echo -e "    Max        : ${max}ms"
echo -e "    p50        : ${p50}ms"
echo -e "    p95        : ${p95}ms"
echo -e "    p99        : ${p99}ms"

echo -e ""
echo -e "  ${BOLD}Temps total test${RESET} : ${GLOBAL_ELAPSED}s"

# Analyse qualitative automatique
echo ""
echo -e "  ${BOLD}Analyse automatique${RESET}"

if [ "$p95" != "0" ] && [ "$p95" -gt 10000 ]; then
  echo -e "    ${YELLOW}⚠${RESET}  p95 > 10s (${p95}ms) — latence élevée sous charge"
fi
if [ "$t_timeout" -gt 0 ]; then
  echo -e "    ${RED}✗${RESET}  ${t_timeout} timeout(s) détecté(s) — problème de stabilité"
fi
if [ "$t_error" -gt 0 ] && [ "$MODE" != "chaos" ] && [ "$MODE" != "full" ]; then
  echo -e "    ${RED}✗${RESET}  ${t_error} erreur(s) sur payloads valides — vérifier logs backend"
fi
if [ "$t_success" -eq "$t_total" ] && [ "$MODE" = "sequential" ]; then
  echo -e "    ${GREEN}✓${RESET}  100% succès en séquentiel — baseline saine"
fi
if [ "$t_timeout" -eq 0 ] && [ "$t_success" -gt 0 ]; then
  echo -e "    ${GREEN}✓${RESET}  Aucun timeout — backend stable dans ce mode"
fi

# Build JSON
build_json

echo ""
echo -e "  ${BOLD}Fichiers${RESET}"
echo -e "    JSON    : ${CYAN}${RESULTS_FILE}${RESET}"

# Rapport texte
{
  echo "Revolution API — Hard Stress Test Report"
  echo "Timestamp : ${TIMESTAMP}"
  echo "Mode      : ${MODE}"
  echo "Concurrence: ${CONCURRENCY}"
  echo ""
  echo "=== VOLUME ==="
  echo "Total    : ${t_total}"
  echo "Succès   : ${t_success}"
  echo "Erreurs  : ${t_error}"
  echo "Timeouts : ${t_timeout}"
  echo "No-ID    : ${t_noid}"
  echo ""
  echo "=== LATENCES ==="
  echo "Avg : ${avg}ms"
  echo "Min : ${min}ms"
  echo "Max : ${max}ms"
  echo "p50 : ${p50}ms"
  echo "p95 : ${p95}ms"
  echo "p99 : ${p99}ms"
  echo ""
  echo "=== DETAIL PAR JOB ==="
  for f in "${TMP_DIR}"/*.meta; do
    [ -f "$f" ] && cat "$f"
  done
} > "$REPORT_FILE"

echo -e "    Rapport : ${CYAN}${REPORT_FILE}${RESET}"
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${RESET}"
echo ""

# Nettoyage
rm -rf "$TMP_DIR"
