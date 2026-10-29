#!/bin/bash
set -e

# Resolve paths before changing the working directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/khiops-visualization-desktop"
COMPONENT_DIR="$REPO_ROOT/visualization-component"
ANGULAR_JSON="$DESKTOP_DIR/angular.json"
APP_COMPONENT_PATH="$DESKTOP_DIR/src/app/app.component.ts"

if [ ! -d "$COMPONENT_DIR" ]; then
    echo "ERROR: visualization-component was not found at $COMPONENT_DIR."
    exit 1
fi

# BSD sed (macOS) requires an explicit backup suffix after -i.
if [ "$(uname -s)" = "Darwin" ]; then
    SED_INPLACE=(-i '')
else
    SED_INPLACE=(-i)
fi

# Update the angular.json file to replace the style and script paths
sed "${SED_INPLACE[@]}" 's/"styles": \["src\/styles.scss"\]/"styles": ["..\/visualization-component\/dist\/khiops-webcomponent\/styles.css", "src\/styles.scss"]/' "$ANGULAR_JSON"
sed "${SED_INPLACE[@]}" 's/"scripts": \[\]/"scripts": ["..\/visualization-component\/dist\/khiops-webcomponent\/main.js"]/' "$ANGULAR_JSON"

# Ensure desktop app does not import npm package directly during dev startup.
if grep -q "^import 'khiops-visualization';" "$APP_COMPONENT_PATH"; then
    sed "${SED_INPLACE[@]}" "s|^import 'khiops-visualization';|// import 'khiops-visualization';|" "$APP_COMPONENT_PATH"
fi

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
    pkill -TERM -P $$ 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

# Watch main.js — produced directly by ng build, exists before the bundle post-processing step
BUNDLE_PATH="$COMPONENT_DIR/dist/khiops-webcomponent/main.js"

# Remove previous build artifacts to prevent false-positive readiness detection
cd "$COMPONENT_DIR"
rm -f dist/khiops-webcomponent/main.js
rm -f dist/khiops-webcomponent/khiops-webcomponents.bundle.js

# Change directory to visualization component and build development webcomponents
yarn buildDev:webcomponents &
WEBCOMPONENT_PID=$!
PIDS+=($WEBCOMPONENT_PID)

echo "Waiting for webcomponents build to be ready..."
echo "Watching: $BUNDLE_PATH"

# Wait until the bundle file exists (first build completed), without hanging
# forever when Angular reports a compilation error but keeps watching.
BUILD_TIMEOUT_SECONDS=600
BUILD_START_TIME=$(date +%s)
while [ ! -f "$BUNDLE_PATH" ]; do
    if ! kill -0 "$WEBCOMPONENT_PID" 2>/dev/null; then
        echo "ERROR: webcomponents build process exited unexpectedly."
        exit 1
    fi
    if [ "$(( $(date +%s) - BUILD_START_TIME ))" -ge "$BUILD_TIMEOUT_SECONDS" ]; then
        echo "ERROR: webcomponents build did not produce main.js within ${BUILD_TIMEOUT_SECONDS}s."
        exit 1
    fi
    sleep 2
done

# Wait until the file is no longer being written to (build fully settled)
PREV_SIZE=0
STABLE_COUNT=0
while [ "$STABLE_COUNT" -lt 3 ]; do
    CURR_SIZE=$(node -e "process.stdout.write(String(require('node:fs').statSync(process.argv[1]).size))" "$BUNDLE_PATH")
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
cd "$DESKTOP_DIR"
yarn start &
START_PID=$!
PIDS+=($START_PID)

# Wait for all background processes
wait