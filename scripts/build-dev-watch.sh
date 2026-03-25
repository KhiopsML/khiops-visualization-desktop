
#!/bin/bash

ANGULAR_JSON="angular.json"

# Update the angular.json file to replace the script path
sed -i 's/"scripts": \[\]/"scripts": ["..\/visualization-component\/dist\/khiops-webcomponent\/main.js"]/' $ANGULAR_JSON

# Store PIDs for cleanup
PIDS=()

# Kill all child processes on exit (window close, Ctrl+C, etc.)
cleanup() {
    echo "Cleaning up processes..."
    for PID in "${PIDS[@]}"; do
        if kill -0 "$PID" 2>/dev/null; then
            kill -TERM "$PID" 2>/dev/null
        fi
    done
    pkill -TERM -P $$ 2>/dev/null
    wait 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# Resolve absolute paths before any cd
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# Watch main.js — produced directly by ng build, exists before the bundle post-processing step
BUNDLE_PATH="$REPO_ROOT/visualization-component/dist/khiops-webcomponent/main.js"

# Change directory to visualization component and build development webcomponents
cd "$REPO_ROOT/visualization-component"
yarn buildDev:webcomponents &
WEBCOMPONENT_PID=$!
PIDS+=($WEBCOMPONENT_PID)

echo "Waiting for webcomponents build to be ready..."
echo "Watching: $BUNDLE_PATH"

# Wait until the bundle file exists (first build completed)
until [ -f "$BUNDLE_PATH" ]; do
    if ! kill -0 "$WEBCOMPONENT_PID" 2>/dev/null; then
        echo "ERROR: webcomponents build process exited unexpectedly."
        exit 1
    fi
    sleep 2
done

# Wait until the file is no longer being written to (build fully settled)
PREV_SIZE=0
STABLE_COUNT=0
while [ "$STABLE_COUNT" -lt 3 ]; do
    CURR_SIZE=$(stat -c%s "$BUNDLE_PATH" 2>/dev/null || echo 0)
    if [ "$CURR_SIZE" -eq "$PREV_SIZE" ] && [ "$CURR_SIZE" -gt 0 ]; then
        STABLE_COUNT=$((STABLE_COUNT + 1))
    else
        STABLE_COUNT=0
    fi
    PREV_SIZE=$CURR_SIZE
    sleep 1
done

echo "Webcomponents build is ready. Starting the application..."

# Start the application
cd "$REPO_ROOT/khiops-visualization-desktop"
yarn start &
START_PID=$!
PIDS+=($START_PID)

# Wait for all background processes
wait