const { spawn } = require('child_process');

/**
 * Manages Claude Code CLI subprocess for AI code generation.
 * Each request spawns a fresh Claude CLI process (no persistent mode available).
 */

/**
 * Send a prompt to Claude Code CLI and get a response.
 *
 * @param {string} userMessage - The user's natural language request
 * @param {string} currentCode - The current Build123d code (empty string if none)
 * @param {Array} chatHistory - Array of {role, content} messages
 * @param {Object} clickInfo - Optional click information {position: {x, y, z}, normal: {x, y, z}}
 * @returns {Promise<string>} Claude's raw response text
 */
function sendPrompt(userMessage, currentCode = '', chatHistory = [], clickInfo = null) {
  return new Promise((resolve, reject) => {
    // Build the full prompt
    const prompt = buildPrompt(userMessage, currentCode, chatHistory, clickInfo);

    console.log('[ClaudeManager] Sending prompt to Claude CLI...');
    console.log('[ClaudeManager] Prompt length:', prompt.length);

    // Spawn Claude CLI process
    // Use stdin to pass prompt (avoids shell escaping issues with backticks)
    const process = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Write prompt to stdin and close it
    process.stdin.write(prompt);
    process.stdin.end();

    let stdoutData = '';
    let stderrData = '';
    let timeoutId = null;
    let isResolved = false;

    // Set 30 second timeout
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        console.error('[ClaudeManager] Claude CLI timeout (30s)');
        isResolved = true;
        process.kill();
        reject(new Error('Claude is taking too long (timeout after 30 seconds)'));
      }
    }, 30000);

    // Capture stdout
    process.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    // Capture stderr (for error diagnostics)
    process.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    // Handle process errors
    process.on('error', (err) => {
      if (!isResolved) {
        console.error('[ClaudeManager] Process error:', err);
        isResolved = true;
        clearTimeout(timeoutId);
        reject(new Error(`Cannot reach Claude: ${err.message}`));
      }
    });

    // Handle process exit
    process.on('exit', (code, signal) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeoutId);

        console.log(`[ClaudeManager] Process exited with code ${code}, signal ${signal}`);

        if (code === 0) {
          // Success - return the captured stdout
          console.log('[ClaudeManager] Response received, length:', stdoutData.length);
          resolve(stdoutData);
        } else {
          // Error
          console.error('[ClaudeManager] Claude CLI failed with code:', code);
          console.error('[ClaudeManager] stderr:', stderrData);
          reject(new Error(`Claude CLI failed (exit code ${code}): ${stderrData || 'Unknown error'}`));
        }
      }
    });
  });
}

/**
 * Build the full prompt to send to Claude.
 * Includes system context, current code, chat history, click info, and user message.
 *
 * @param {string} userMessage - The user's current request
 * @param {string} currentCode - The current Build123d code
 * @param {Array} chatHistory - Previous messages (last 5 max)
 * @param {Object} clickInfo - Optional click information {position: {x, y, z}, normal: {x, y, z}}
 * @returns {string} The complete prompt
 */
function buildPrompt(userMessage, currentCode, chatHistory, clickInfo = null) {
  let prompt = '';

  // System context
  prompt += '# Role\n\n';
  prompt += 'You are a CAD assistant that generates Build123d Python code for 3D models.\n\n';

  // Code requirements - two modes
  prompt += '# Code Requirements\n\n';
  prompt += 'IMPORTANT: Choose the right pattern based on what you need:\n\n';

  prompt += '## Multi-Colored Shapes (DEFAULT)\n\n';
  prompt += 'DO NOT use BuildPart() - it fuses shapes into one solid and loses individual colors.\n\n';
  prompt += 'Rules:\n';
  prompt += '- Create shapes: Box(), Sphere(), Cylinder(), Cone(), etc.\n';
  prompt += '- Position shapes: Pos(x, y, z) * shape (NOT shape @ Pos - that doesn\'t work)\n';
  prompt += '- Assign colors: shape.color = Color("red") or Color(r, g, b)\n';
  prompt += '- Group with Compound([shape1, shape2, ...]) - keeps shapes separate\n';
  prompt += '- For oriented cones/cylinders: Pos(x,y,z) * Solid.make_cone(..., plane=...) or Solid.make_cylinder(..., plane=...)\n';
  prompt += '- CRITICAL: Final result MUST be assigned to variable named `part`\n\n';

  prompt += '## Single Fused Solid (only when needed)\n\n';
  prompt += 'Use BuildPart() ONLY when you need boolean operations or intentional fusing:\n\n';
  prompt += '```python\n';
  prompt += 'with BuildPart() as part:\n';
  prompt += '    Box(50, 50, 50)\n';
  prompt += '    Hole(10)  # Boolean subtraction\n';
  prompt += '    fillet(part.edges(), 2)\n';
  prompt += '```\n\n';
  prompt += 'This creates ONE solid with ONE color.\n\n';

  prompt += '## General Rules\n\n';
  prompt += '- DO NOT include any export lines - handled automatically\n';
  prompt += '- All measurements in millimeters\n';
  prompt += '- Named colors: red, blue, green, yellow, white, black, orange, purple, cyan, magenta, gray\n';
  prompt += '- RGB colors: Color(r, g, b) with values 0-1\n\n';

  prompt += '## Coordinate System\n\n';
  prompt += 'Directions: +Z=up, -Z=down, +Y=forward, -Y=backward, +X=right, -X=left\n\n';

  prompt += '## Shape Orientation\n\n';
  prompt += 'Shapes orient naturally based on description:\n';
  prompt += '- "pointing up" = along +Z axis\n';
  prompt += '- "pointing forward" = along +Y axis\n';
  prompt += '- "pointing right" = along +X axis\n';
  prompt += '- Cylinders/cones default to +Z (upright)\n\n';

  // Limitations
  prompt += '# Limitations\n\n';
  prompt += '- Only uniform scaling is supported (no stretched/squashed shapes like ellipsoids)\n';
  prompt += '- No freeform/organic surfaces\n';
  prompt += '- No text or fonts\n';
  prompt += '- Keep geometry relatively simple - basic shapes, holes, fillets, shells\n\n';

  // Complexity handling
  prompt += '# If Request Is Too Complex\n\n';
  prompt += 'If you cannot create what the user asked for, say "I can\'t make that because it\'s too complicated" and suggest a simpler alternative. ';
  prompt += 'For example: "I can\'t make ellipsoid eyes - would sphere eyes work instead?"\n\n';

  // Current code context
  if (currentCode && currentCode.trim()) {
    prompt += '# Current Model Code\n\n';
    prompt += '```python\n';
    prompt += currentCode;
    prompt += '\n```\n\n';
  }

  // Chat history (last 5 messages max)
  if (chatHistory && chatHistory.length > 0) {
    prompt += '# Conversation History\n\n';

    // Keep only last 5 messages for context
    const recentHistory = chatHistory.length > 5
      ? chatHistory.slice(-5)
      : chatHistory;

    for (const msg of recentHistory) {
      prompt += `**${msg.role}:** ${msg.content}\n\n`;
    }
  }

  // Output format instructions
  prompt += '# Instructions\n\n';
  prompt += '1. Generate valid Build123d Python code in a single ```python code block\n';
  prompt += '2. Include a brief explanation of what you changed/created\n';
  prompt += '3. Ensure all measurements are in millimeters\n';
  prompt += '4. The code should be complete and executable\n';
  prompt += '5. Do NOT include any export lines (export_stl, export_gltf, etc.) - the system handles export automatically\n';
  prompt += '6. CRITICAL: Your code MUST end with assigning the final geometry to a variable named `part` (e.g., `part = Compound([...])`)\n';
  prompt += '7. If creating an entirely NEW model (not modifying the existing one), include exactly `NEW_MODEL: true` on its own line in your response\n\n';

  // User's current request
  prompt += '# User Request\n\n';
  prompt += userMessage;

  // Add click info if available
  if (clickInfo && clickInfo.position) {
    prompt += '\n\n# Click Context\n\n';
    const pos = clickInfo.position;
    prompt += `User clicked at position (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`;

    if (clickInfo.normal) {
      const norm = clickInfo.normal;
      prompt += ` on surface with normal (${norm.x.toFixed(1)}, ${norm.y.toFixed(1)}, ${norm.z.toFixed(1)})`;
    }

    prompt += '.\n';
  }

  return prompt;
}

/**
 * Parse Claude's response to extract Python code, explanation, and flags.
 *
 * @param {string} responseText - The raw response from Claude CLI
 * @returns {Object} { code: string|null, explanation: string, raw: string, newModel: boolean }
 */
function parseResponse(responseText) {
  // Store the original raw response
  const raw = responseText;

  // Check for NEW_MODEL flag
  const newModelRegex = /^NEW_MODEL:\s*true\s*$/im;
  const newModel = newModelRegex.test(responseText);
  if (newModel) {
    console.log('[ClaudeManager] NEW_MODEL flag detected - this is a new model');
  }

  // Regex to match Python code blocks: ```python\n...\n```
  const codeBlockRegex = /```python\n([\s\S]*?)```/g;

  // Find all code blocks
  const matches = [...responseText.matchAll(codeBlockRegex)];

  let code = null;
  let explanation = responseText;

  if (matches.length === 0) {
    // No code blocks found
    console.log('[ClaudeManager] No Python code block found in response');
    code = null;
    explanation = responseText.trim();
  } else {
    // Extract the first code block
    code = matches[0][1].trim();

    // Warn if multiple code blocks exist
    if (matches.length > 1) {
      console.warn(`[ClaudeManager] Multiple code blocks found (${matches.length}), using first one`);
    }

    // Extract explanation (everything outside code blocks)
    // Remove all code blocks and NEW_MODEL flag from the response
    explanation = responseText
      .replace(codeBlockRegex, '')
      .replace(newModelRegex, '')
      .trim();
  }

  return {
    code,
    explanation,
    newModel,
    raw
  };
}

/**
 * Clear Claude CLI context by sending /clear command.
 * @returns {Promise<void>}
 */
function clearContext() {
  return new Promise((resolve, reject) => {
    console.log('[ClaudeManager] Clearing Claude context...');

    const process = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send /clear command
    process.stdin.write('/clear');
    process.stdin.end();

    let timeoutId = setTimeout(() => {
      console.error('[ClaudeManager] Clear context timeout');
      process.kill();
      reject(new Error('Clear context timeout'));
    }, 10000);

    process.on('exit', (code) => {
      clearTimeout(timeoutId);
      if (code === 0) {
        console.log('[ClaudeManager] Context cleared successfully');
        resolve();
      } else {
        // Even if exit code is non-zero, /clear might have worked
        console.log('[ClaudeManager] Clear command completed (exit code:', code, ')');
        resolve();
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeoutId);
      console.error('[ClaudeManager] Clear context error:', err);
      reject(err);
    });
  });
}

/**
 * Build and send a continuation prompt to re-establish context.
 * This doesn't expect code in response - just establishes state.
 *
 * @param {string} currentCode - The current Build123d code
 * @param {Array} cleanedHistory - Chat history without errors/failures
 * @returns {Promise<void>}
 */
function sendContinuationPrompt(currentCode, cleanedHistory = []) {
  return new Promise((resolve, reject) => {
    console.log('[ClaudeManager] Sending continuation prompt...');

    let prompt = '# Context Restoration\n\n';
    prompt += 'You are a CAD assistant that generates Build123d Python code.\n\n';

    // Current model code
    if (currentCode && currentCode.trim()) {
      prompt += '# Current Model Code (Ground Truth)\n\n';
      prompt += '```python\n';
      prompt += currentCode;
      prompt += '\n```\n\n';
    } else {
      prompt += '# Current Model\n\nNo model currently loaded.\n\n';
    }

    // Cleaned chat history
    if (cleanedHistory && cleanedHistory.length > 0) {
      prompt += '# Previous Conversation\n\n';
      for (const msg of cleanedHistory) {
        prompt += `**${msg.role}:** ${msg.content}\n\n`;
      }
    }

    prompt += '# Status\n\n';
    prompt += 'Context has been refreshed. The code above is the current state. Await next user command.\n';

    const process = spawn('claude', ['--print'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    process.stdin.write(prompt);
    process.stdin.end();

    let timeoutId = setTimeout(() => {
      console.error('[ClaudeManager] Continuation prompt timeout');
      process.kill();
      reject(new Error('Continuation prompt timeout'));
    }, 30000);

    process.on('exit', (code) => {
      clearTimeout(timeoutId);
      console.log('[ClaudeManager] Continuation prompt sent (exit code:', code, ')');
      resolve();
    });

    process.on('error', (err) => {
      clearTimeout(timeoutId);
      console.error('[ClaudeManager] Continuation prompt error:', err);
      reject(err);
    });
  });
}

/**
 * Refresh Claude context: clear and re-establish with current state.
 *
 * @param {string} currentCode - The current Build123d code
 * @param {Array} cleanedHistory - Chat history without errors/failures
 * @returns {Promise<void>}
 */
async function refreshContext(currentCode, cleanedHistory = []) {
  await clearContext();
  await sendContinuationPrompt(currentCode, cleanedHistory);
}

/**
 * Build prompt for design mode (spec generation, not code).
 *
 * @param {string} userMessage - What the user wants to design
 * @param {string} currentSpec - Current spec content (for refinements)
 * @param {Array} chatHistory - Previous messages
 * @returns {string} The complete prompt
 */
function buildDesignPrompt(userMessage, currentSpec = '', chatHistory = []) {
  let prompt = '';

  // Role
  prompt += '# Role\n\n';
  prompt += 'You are a CAD design assistant. You help users plan 3D models by creating detailed specifications.\n';
  prompt += 'You do NOT generate code in this mode. You generate structured specs.\n\n';

  // Output format
  prompt += '# Output Format\n\n';
  prompt += 'Generate a structured specification in markdown format with these sections:\n\n';
  prompt += '## Model Name and Description\n';
  prompt += 'Brief description of what we\'re building.\n\n';
  prompt += '## Coordinate System\n';
  prompt += '- Z = up/down, Y = forward/back, X = left/right\n';
  prompt += '- Units: millimeters\n\n';
  prompt += '## Components\n';
  prompt += 'List each component with:\n';
  prompt += '- Primitive type (Box, Sphere, Cylinder, Cone, etc.)\n';
  prompt += '- Exact dimensions in mm\n';
  prompt += '- Position (center point x, y, z)\n';
  prompt += '- Color\n';
  prompt += '- Any boolean operations (union, subtract)\n\n';
  prompt += '## Optional Details\n';
  prompt += '- Fillets, chamfers\n';
  prompt += '- Holes\n';
  prompt += '- Patterns\n\n';

  // Reference example
  prompt += '# Example Spec Format\n\n';
  prompt += '```markdown\n';
  prompt += '# Snowman (50mm tall)\n\n';
  prompt += '## Coordinate System\n';
  prompt += '- Z = up/down, Y = forward/back, X = left/right\n';
  prompt += '- Units: millimeters\n\n';
  prompt += '## 1) Base sphere\n';
  prompt += '- Sphere: diameter 30mm\n';
  prompt += '- Center at (0, 0, 15)\n';
  prompt += '- Color: white\n\n';
  prompt += '## 2) Middle sphere\n';
  prompt += '- Sphere: diameter 22mm\n';
  prompt += '- Center at (0, 0, 37)\n';
  prompt += '- Color: white\n';
  prompt += '```\n\n';

  // Constraints (same as code mode)
  prompt += '# Constraints\n\n';
  prompt += '- Only primitives: Box, Sphere, Cylinder, Cone\n';
  prompt += '- No ellipsoids (only uniform scaling)\n';
  prompt += '- No freeform surfaces\n';
  prompt += '- No text/fonts\n';
  prompt += '- Keep it buildable with basic CAD operations\n\n';

  // Current spec (if refining)
  if (currentSpec && currentSpec.trim()) {
    prompt += '# Current Spec (refine this)\n\n';
    prompt += '```markdown\n';
    prompt += currentSpec;
    prompt += '\n```\n\n';
  }

  // Chat history (last 5)
  if (chatHistory && chatHistory.length > 0) {
    prompt += '# Conversation History\n\n';
    const recentHistory = chatHistory.slice(-5);
    for (const msg of recentHistory) {
      prompt += `**${msg.role}:** ${msg.content}\n\n`;
    }
  }

  // User request
  prompt += '# User Request\n\n';
  prompt += userMessage;

  return prompt;
}

/**
 * Parse design mode response (markdown spec, not code).
 *
 * @param {string} responseText - The raw response from Claude CLI
 * @returns {Object} { spec: string, raw: string }
 */
function parseDesignResponse(responseText) {
  return {
    spec: responseText.trim(),
    raw: responseText
  };
}

module.exports = {
  sendPrompt,
  buildPrompt,
  buildDesignPrompt,
  parseResponse,
  parseDesignResponse,
  clearContext,
  sendContinuationPrompt,
  refreshContext
};
