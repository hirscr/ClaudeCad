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

    # Build prompt (artur.md injected via --system-prompt)
    FULL_PROMPT="$TASK_PROMPT

After completing the task, report what you changed."

    claude -p \
        --model sonnet \
        --system-prompt "$(cat artur.md)" \
        --dangerously-skip-permissions \
        "$FULL_PROMPT"

    EXIT_CODE=$?

    # Check for code changes (success = code changed, regardless of exit code)
    TASK_TITLE=$(jq -r ".[$TASK_IDX].title" prompts.json)
    git add -A
    CODE_CHANGES=$(git diff --cached --name-only | grep -v prompts.json | grep -v run_tasks.sh | grep -v artur.md | wc -l | tr -d ' ')

    if [ "$CODE_CHANGES" -gt "0" ]; then
        # Code changed = success (even if exit code was non-zero)
        mark_complete "$TASK_IDX"
        git commit -m "Task $TASK_IDX complete: $TASK_TITLE" -q
        echo "--- Task $TASK_IDX complete ($CODE_CHANGES files changed) ---"
        if [ $EXIT_CODE -ne 0 ]; then
            echo "    (Note: Claude exited with code $EXIT_CODE but work was done)"
        fi
    elif [ $EXIT_CODE -eq 0 ]; then
        # No changes but exit 0 = already done
        git reset HEAD -q 2>/dev/null
        mark_complete "$TASK_IDX"
        echo "--- Task $TASK_IDX already complete (no changes needed) ---"
    else
        # No changes AND non-zero exit = real failure
        git reset HEAD -q 2>/dev/null
        echo ""
        echo "!!! Failed: No code changes and exit code $EXIT_CODE !!!"
        echo "Pausing. Press Enter to retry or Ctrl+C to abort."
        read
        continue
    fi

    TASK_NUM=$((TASK_NUM + 1))

    echo ""
    echo "--- Pausing 3 seconds before next task ---"
    sleep 3
done
