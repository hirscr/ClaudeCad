# Phase 8 Task 5: Claude Prompt with Images - COMPLETE

## Summary
Added support for passing image file paths to Claude CLI via `--add-dir` flag and including image references in the prompt text.

## Changes Made

### 1. `src/main/claude-manager.js`

#### Updated `sendPrompt()` function:
- **Old signature**: `sendPrompt(userMessage, currentCode, chatHistory, clickInfo)`
- **New signature**: `sendPrompt(prompt, tempImageDir = null)`
- Changed to accept pre-built prompt and optional temp directory
- Adds `--add-dir <tempImageDir>` to Claude CLI args when images are present
- Added debug logging for image directory and prompt preview

#### Updated `buildPrompt()` function:
- Added optional `imagePaths` parameter: `buildPrompt(userMessage, currentCode, chatHistory, clickInfo = null, imagePaths = null)`
- Inserts "# Reference Images" section early in prompt (after Role, before Code Requirements)
- Lists each image with format: `- Image ${number}: ${path}`

### 2. `src/main/main.js`

#### Updated `send-chat-message` IPC handler:
- Added `imagePaths` to destructured parameters
- Calls `buildPrompt()` with all parameters including `imagePaths`
- Determines `tempImageDir` based on whether images exist: `imagePaths && imagePaths.length > 0 ? TEMP_IMAGE_DIR : null`
- Passes `tempImageDir` to `sendPrompt(prompt, tempImageDir)`
- Added debug logging for image paths

#### Updated other handlers to use new signature:
- `send-design-message`: Calls `sendPrompt(prompt, null)` (no images)
- `build-from-spec`: Calls `sendPrompt(prompt, null)` (no images)

## How It Works

1. Renderer sends `imagePaths` array (from Task 8-4) via IPC: `[{ number: 1, path: "/tmp/claudecad-images/img_001.png" }, ...]`
2. Main process:
   - Calls `buildPrompt(..., imagePaths)` which inserts image paths into prompt text
   - If images exist, passes `TEMP_IMAGE_DIR` to `sendPrompt()`
   - `sendPrompt()` adds `--add-dir` flag to Claude CLI args
3. Claude CLI receives:
   - Directory access via `--add-dir /tmp/claudecad-images`
   - Prompt text containing inline image paths
4. Claude can read the images and respond with code based on visual content

## Testing Checklist

- [x] Syntax check passes (no JavaScript errors)
- [ ] npm start (not run per instructions)
- [ ] Test with pasted image: "Recreate this shape"
- [ ] Verify console logs show image paths in prompt
- [ ] Test with multiple images
- [ ] Test without images (should work as before)

## Debug Output

When images are present, you'll see:
```
[Main] Image paths being sent: [{"number":1,"path":"/tmp/claudecad-images/img_001.png"}]
[ClaudeManager] Temp image dir: /tmp/claudecad-images
[ClaudeManager] Full prompt preview: # Role...
```

## Notes

- Image paths persist through retries (only `clickInfo` is cleared on retry)
- Design mode and spec-based generation explicitly pass `null` for images
- Temp directory already exists (created by Task 8-4)
- The `--add-dir` flag was verified to work with Claude CLI in earlier tasks

## Next Steps

- Task 8-6: Viewport Capture (screenshot current 3D view)
- Task 8-7+: Iteration loop (not part of this task)
