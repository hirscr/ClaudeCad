#!/bin/bash
# Autonomous task runner for ClaudeCAD
# Reads tasks from prompts.json, passes only the current task to Claude

cd /Users/roberf/Dropbox/Programming/Python/ClaudeCad

# Check jq is available
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. Install with: brew install jq"
    exit 1
fi

# Get first incomplete task index and prompt
get_next_task() {
    jq -r 'to_entries | map(select(.value.complete == false)) | .[0] | .key // empty' prompts.json
}

get_task_prompt() {
    local idx=$1
    jq -r ".[$idx].prompt" prompts.json
}

mark_complete() {
    local idx=$1
    jq ".[$idx].complete = true" prompts.json > prompts.json.tmp && mv prompts.json.tmp prompts.json
}

count_remaining() {
    jq '[.[] | select(.complete == false)] | length' prompts.json
}

echo "=== ClaudeCAD Autonomous Task Runner ==="
echo "Using model: sonnet"
echo "Reading tasks from: prompts.json"
echo ""
echo "WARNING: This will auto-execute all tool calls without prompting."
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5
echo ""
echo "Starting autonomous execution..."

TASK_NUM=1

while true; do
    REMAINING=$(count_remaining)
    TASK_IDX=$(get_next_task)

    if [ -z "$TASK_IDX" ]; then
        echo ""
        echo "========================================="
        echo "=== ALL TASKS COMPLETE ==="
        echo "========================================="
        echo ""
        echo "Next steps:"
        echo "1. Test the phase: npm start"
        echo "2. If good, commit: git add -A && git commit -m 'Phase N complete'"
        echo "3. Create prompts.json for next phase"
        exit 0
    fi

    TASK_PROMPT=$(get_task_prompt "$TASK_IDX")

    echo ""
    echo "========================================="
    echo "=== Running task index $TASK_IDX ($REMAINING remaining) ==="
    echo "========================================="
    echo ""

    # Write prompt to temp file to avoid shell escaping issues
    TEMP_PROMPT=$(mktemp)
    echo "$TASK_PROMPT" > "$TEMP_PROMPT"
    echo "" >> "$TEMP_PROMPT"
    echo "After completing the task, report what you changed." >> "$TEMP_PROMPT"

    echo "--- DEBUG: Prompt file: $TEMP_PROMPT ---"
    echo "--- DEBUG: First 200 chars of prompt: ---"
    head -c 200 "$TEMP_PROMPT"
    echo ""
    echo "--- DEBUG: Running claude... ---"

    claude -p \
        --model sonnet \
        --system-prompt "$(cat artur.md)" \
        --output-format json \
        --dangerously-skip-permissions \
        -- "$(cat "$TEMP_PROMPT")"

    EXIT_CODE=$?
    rm -f "$TEMP_PROMPT"
    if [ $EXIT_CODE -ne 0 ]; then
        echo ""
        echo "!!! Claude exited with error code $EXIT_CODE !!!"
        echo "You can reset partial changes with: git checkout ."
        echo "Pausing. Press Enter to retry or Ctrl+C to abort."
        read
    else
        # Mark task complete on success
        mark_complete "$TASK_IDX"
        echo "--- Marked task $TASK_IDX complete ---"

        # Git checkpoint after successful task
        TASK_TITLE=$(jq -r ".[$TASK_IDX].title" prompts.json)
        git add -A

        # Check if there are actual code changes (not just prompts.json)
        CODE_CHANGES=$(git diff --cached --name-only | grep -v prompts.json | wc -l | tr -d ' ')
        if [ "$CODE_CHANGES" -eq "0" ]; then
            echo ""
            echo "!!! ERROR: No code files were changed !!!"
            echo "Artur marked task complete without implementing anything."
            echo "Resetting prompts.json and retrying..."
            git checkout prompts.json
            echo "Press Enter to retry this task..."
            read
            continue
        fi

        git commit -m "Task $TASK_IDX complete: $TASK_TITLE" -q
        echo "--- Git checkpoint: Task $TASK_IDX ($CODE_CHANGES files changed) ---"
    fi

    TASK_NUM=$((TASK_NUM + 1))

    echo ""
    echo "--- Pausing 3 seconds before next task ---"
    sleep 3
done
