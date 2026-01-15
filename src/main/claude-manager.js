const { spawn } = require('child_process');

/**
 * Manages Claude Code CLI subprocess for AI code generation.
 * Each request spawns a fresh Claude CLI process (no persistent mode available).
 */

/**
 * Send a prompt to Claude Code CLI and get a response.
 *
 * @param {string} prompt - The complete prompt text to send
 * @param {string} tempImageDir - Path to temp image directory (for --add-dir), optional
 * @returns {Promise<string>} Claude's raw response text
 */
function sendPrompt(prompt, tempImageDir = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    console.log('[ClaudeManager] Sending prompt to Claude CLI...');
    console.log('[ClaudeManager] Prompt length:', prompt.length);
    console.log('[ClaudeManager] Temp image dir:', tempImageDir || 'none');

    // Build Claude CLI args
    const args = ['--print'];

    // Add image directory access if provided
    if (tempImageDir) {
      args.push('--add-dir', tempImageDir);
    }

    // Spawn Claude CLI process
    // Use stdin to pass prompt (avoids shell escaping issues with backticks)
    const process = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Debug logging for images
    if (tempImageDir) {
      console.log('[ClaudeManager] Full prompt preview:', prompt.substring(0, 500) + '...');
    }

    // Write prompt to stdin and close it
    process.stdin.write(prompt);
    process.stdin.end();

    let stdoutData = '';
    let stderrData = '';
    let timeoutId = null;
    let isResolved = false;

    // Set timeout
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        console.error(`[ClaudeManager] Claude CLI timeout (${timeout / 1000}s)`);
        isResolved = true;
        process.kill();
        reject(new Error(`Claude is taking too long (timeout after ${timeout / 1000} seconds)`));
      }
    }, timeout);

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
 * Includes system context, current code, chat history, click info, images, and user message.
 *
 * @param {string} userMessage - The user's current request
 * @param {string} currentCode - The current Build123d code
 * @param {Array} chatHistory - Previous messages (last 5 max)
 * @param {Object} clickInfo - Optional click information {position: {x, y, z}, normal: {x, y, z}}
 * @param {Array} imagePaths - Optional array of { number, path } for reference images
 * @returns {string} The complete prompt
 */
function buildPrompt(userMessage, currentCode, chatHistory, clickInfo = null, imagePaths = null) {
  let prompt = '';

  // System context
  prompt += '# Role\n\n';
  prompt += 'You are a CAD assistant that generates Build123d Python code for 3D models.\n\n';

  // Add image references if present (before requirements)
  if (imagePaths && imagePaths.length > 0) {
    prompt += '# Reference Images\n\n';
    prompt += 'The user has provided the following images:\n';
    for (const img of imagePaths) {
      prompt += `- Image ${img.number}: ${img.path}\n`;
    }
    prompt += '\n';
  }

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

  // Build123d API reference
  prompt += '## Build123d API Quick Reference\n\n';
  prompt += 'Primitives: Box(length, width, height), Cylinder(radius, height), Sphere(radius), Cone(bottom_r, top_r, height)\n';
  prompt += 'Position: Pos(x, y, z) * shape\n';
  prompt += 'Combine: Compound([shapes...]) keeps separate, shape1 + shape2 (union), shape1 - shape2 (subtract)\n';
  prompt += 'Color: shape.color = Color("red") or Color(0.5, 0.5, 0.5)\n';
  prompt += 'MUST end with: part = Compound([...]) or part = your_shape\n\n';

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

    // Use the updated spawn logic (no images for continuation)
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

/**
 * Build prompt to generate Build123d code from a design spec.
 *
 * @param {string} spec - The design specification (markdown)
 * @returns {string} The complete prompt
 */
function buildCodeFromSpecPrompt(spec) {
  let prompt = '';

  // Role
  prompt += '# Role\n\n';
  prompt += 'You are a CAD assistant that generates Build123d Python code from design specifications.\n\n';

  // Code requirements (same as buildPrompt)
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

  // Build123d API reference
  prompt += '## Build123d API Quick Reference\n\n';
  prompt += 'Primitives: Box(length, width, height), Cylinder(radius, height), Sphere(radius), Cone(bottom_r, top_r, height)\n';
  prompt += 'Position: Pos(x, y, z) * shape\n';
  prompt += 'Combine: Compound([shapes...]) keeps separate, shape1 + shape2 (union), shape1 - shape2 (subtract)\n';
  prompt += 'Color: shape.color = Color("red") or Color(0.5, 0.5, 0.5)\n';
  prompt += 'MUST end with: part = Compound([...]) or part = your_shape\n\n';

  // Limitations
  prompt += '# Limitations\n\n';
  prompt += '- Only uniform scaling is supported (no stretched/squashed shapes like ellipsoids)\n';
  prompt += '- No freeform/organic surfaces\n';
  prompt += '- No text or fonts\n';
  prompt += '- Keep geometry relatively simple - basic shapes, holes, fillets, shells\n\n';

  // The spec to build from
  prompt += '# Design Specification\n\n';
  prompt += 'Build the following design exactly as specified:\n\n';
  prompt += '```markdown\n';
  prompt += spec;
  prompt += '\n```\n\n';

  // Instructions
  prompt += '# Instructions\n\n';
  prompt += '1. Generate valid Build123d Python code in a single ```python code block\n';
  prompt += '2. Follow the spec exactly - use the dimensions, positions, and colors specified\n';
  prompt += '3. Include a brief explanation of what you built\n';
  prompt += '4. CRITICAL: Your code MUST end with assigning the final geometry to a variable named `part`\n';
  prompt += '5. Include `NEW_MODEL: true` on its own line since this is a new model from spec\n';

  return prompt;
}

/**
 * Strip comments from Python code to prevent drift during iteration.
 * Removes single-line comments (#...) and multi-line docstrings ("""...""" or '''...''').
 *
 * @param {string} code - Python code
 * @returns {string} Code with comments stripped
 */
function stripPythonComments(code) {
  if (!code) return code;

  // Remove multi-line docstrings ("""...""" or '''...''')
  let stripped = code.replace(/"""[\s\S]*?"""/g, '');
  stripped = stripped.replace(/'''[\s\S]*?'''/g, '');

  // Remove single-line comments, but preserve the line structure
  const lines = stripped.split('\n');
  const cleanedLines = lines
    .map(line => {
      // Find # that's not inside a string
      // Simple approach: remove everything after # if it's not inside quotes
      const hashIndex = line.indexOf('#');
      if (hashIndex === -1) return line;

      // Check if # is inside a string (simple heuristic: count quotes before it)
      const beforeHash = line.substring(0, hashIndex);
      const singleQuotes = (beforeHash.match(/'/g) || []).length;
      const doubleQuotes = (beforeHash.match(/"/g) || []).length;

      // If both quote counts are even, the # is outside strings
      if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
        return line.substring(0, hashIndex).trimEnd();
      }
      return line;
    })
    .filter(line => line.trim() !== ''); // Remove empty lines

  return cleanedLines.join('\n');
}

/**
 * Build iteration prompt for autonomous iteration mode (SHAPE ONLY).
 * Colors are handled in a separate pass.
 * Code comments are stripped to prevent drift.
 *
 * @param {Object} params
 * @param {string} params.originalRequest - User's original request (verbatim)
 * @param {Array} params.referenceImages - Reference images [{number, path}]
 * @param {Array} params.viewportPaths - Current viewport screenshots [{angle, path}]
 * @param {string} params.currentCode - Current Build123d code (may be empty on first iteration)
 * @param {number} params.iteration - Current iteration number
 * @param {number} params.maxIterations - Maximum iterations
 * @param {string} params.previousError - Optional error from previous attempt
 * @returns {string} The complete prompt
 */
function buildIterationPrompt({
  originalRequest,
  referenceImages,
  viewportPaths,
  currentCode,
  iteration,
  maxIterations,
  previousError = null
}) {
  let prompt = '';

  prompt += `# Shape Iteration ${iteration}/${maxIterations}\n\n`;
  prompt += `Goal: "${originalRequest}"\n\n`;

  // Previous error (if retrying)
  if (previousError) {
    prompt += '# Previous Error\n';
    prompt += `Your last code failed: "${previousError}". Fix this error and try again.\n\n`;
  }

  // Images
  prompt += '# Images\n';
  for (const img of referenceImages) {
    prompt += `Reference ${img.number}: ${img.path}\n`;
  }
  // Output viewport(s) - multiple if angle-specific captures were made
  for (const vp of viewportPaths) {
    if (vp.angle === 'current') {
      prompt += `Current viewport: ${vp.path}\n`;
    } else {
      prompt += `Current ${vp.angle} view: ${vp.path}\n`;
    }
  }
  prompt += '\n';

  // Current code (with comments stripped to prevent drift)
  if (currentCode) {
    const cleanCode = stripPythonComments(currentCode);
    prompt += '# Current Code\n```python\n' + cleanCode + '\n```\n\n';
  } else {
    prompt += '# Current Code\nNone yet - generate initial model.\n\n';
  }

  // Build123d API reference
  prompt += '# Build123d API\n';
  prompt += 'Primitives: Box(length, width, height), Cylinder(radius, height), Sphere(radius), Cone(bottom_r, top_r, height), Wedge(xsize, ysize, zsize, xmin, xmax, zmin, zmax), Torus(major_r, minor_r)\n';
  prompt += 'Position: Pos(x, y, z) * shape\n';
  prompt += 'Combine: Compound([shapes...]) or shape1 + shape2 (union) or shape1 - shape2 (subtract)\n\n';

  // Instructions
  prompt += '# Instructions\n';
  prompt += '1. Study the reference images first. They are ground truth.\n';
  prompt += '2. Compare current viewport to reference. List what\'s wrong or missing.\n';
  prompt += '3. Fix up to 3 shape issues per iteration.\n\n';

  // Rules
  prompt += '# Rules\n';
  prompt += '- Create ALL visible details as separate shapes (bands, panels, stripes, grooves, buttons, vents)\n';
  prompt += '- Use Color("gray") for everything — colors applied in final pass\n';
  prompt += '- Use NAMED VARIABLES for parts (e.g., dome, base, band, panel, ring)\n';
  prompt += '- Do NOT include comments in code\n';
  prompt += '- Positioning: Pos(x,y,z) * shape\n';
  prompt += '- End with: part = Compound([list of parts])\n';
  prompt += '- The final variable MUST be named \'part\' — not \'result\', not \'model\', not anything else\n';
  prompt += '- MUST use Compound() — bare lists like [shape1, shape2] will fail\n';
  prompt += '- Priority: proportions > major parts > detail shapes > positions\n\n';

  prompt += '# Response\n';
  prompt += 'If shape matches reference exactly: NO_CHANGES\n\n';
  prompt += 'Otherwise:\n';
  prompt += 'Missing/Wrong: [list 1-3 specific shape differences]\n';
  prompt += '```python\n# code\n```\n';

  return prompt;
}

/**
 * Build color pass prompt for applying colors after shape iterations.
 *
 * @param {Object} params
 * @param {Array} params.referenceImages - Reference images [{number, path}]
 * @param {string} params.currentCode - Current Build123d code with correct shapes
 * @returns {string} The complete prompt
 */
function buildColorPassPrompt({ referenceImages, currentCode }) {
  let prompt = '';

  prompt += '# Color Pass\n\n';
  prompt += 'The shape is correct. Now apply the correct colors from the reference.\n\n';

  // Images
  prompt += '# Reference Images\n';
  for (const img of referenceImages) {
    prompt += `Image ${img.number}: ${img.path}\n`;
  }
  prompt += '\n';

  // Current code
  prompt += '# Current Code\n```python\n' + currentCode + '\n```\n\n';

  // Instructions
  prompt += '# Rules\n';
  prompt += '- DO NOT change any geometry, sizes, or positions\n';
  prompt += '- ONLY change Color() values to match reference\n';
  prompt += '- Syntax: shape.color = Color("name") or shape.color = Color(r, g, b) with floats 0-1\n';
  prompt += '- DO NOT write Color(shape, "color") — that is invalid\n';
  prompt += '- List the color for each named part before coding\n\n';

  prompt += '# Response\n';
  prompt += 'If colors already correct: NO_CHANGES\n\n';
  prompt += 'Otherwise:\n';
  prompt += 'Colors: part1=color1, part2=color2, ...\n';
  prompt += '```python\ndome.color = Color("silver")\nbody.color = Color(0.2, 0.4, 0.8)\n# ... full code with colors\n```\n';

  return prompt;
}

/**
 * Parse iteration response from Claude.
 *
 * @param {string} responseText - Raw response from Claude
 * @returns {Object} Parsed response: {type: 'no_changes'|'code'|'invalid', code?, raw}
 */
function parseIterationResponse(responseText) {
  const trimmed = responseText.trim();

  // Check for NO_CHANGES
  if (trimmed === 'NO_CHANGES' || trimmed.includes('NO_CHANGES')) {
    return {
      type: 'no_changes',
      raw: responseText
    };
  }

  // Extract code block
  const codeMatch = trimmed.match(/```python\n([\s\S]*?)\n```/);
  if (codeMatch) {
    return {
      type: 'code',
      code: codeMatch[1],
      raw: responseText
    };
  }

  // Invalid response
  return {
    type: 'invalid',
    raw: responseText
  };
}

module.exports = {
  sendPrompt,
  buildPrompt,
  buildDesignPrompt,
  buildCodeFromSpecPrompt,
  buildIterationPrompt,
  buildColorPassPrompt,
  parseResponse,
  parseDesignResponse,
  parseIterationResponse,
  clearContext,
  sendContinuationPrompt,
  refreshContext
};
