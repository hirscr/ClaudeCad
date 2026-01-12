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

  // Build123d code requirements (minimal - Claude knows the API)
  prompt += '# Code Requirements\n\n';
  prompt += 'CRITICAL - Your code MUST use this exact structure:\n';
  prompt += '```\n';
  prompt += 'with BuildPart() as part:\n';
  prompt += '    # all geometry here\n';
  prompt += '```\n';
  prompt += 'The variable MUST be named `part`. Code will fail without this structure.\n\n';
  prompt += 'Other requirements:\n';
  prompt += '- Put all geometry inside the with block\n';
  prompt += '- DO NOT include any export line - handled automatically\n';
  prompt += '- Use any valid Build123d operations\n\n';

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
  prompt += '5. Do NOT include any export lines (export_stl, export_gltf, etc.) - the system handles export automatically\n\n';

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
 * Parse Claude's response to extract Python code and explanation.
 *
 * @param {string} responseText - The raw response from Claude CLI
 * @returns {Object} { code: string|null, explanation: string, raw: string }
 */
function parseResponse(responseText) {
  // Store the original raw response
  const raw = responseText;

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
    // Remove all code blocks from the response
    explanation = responseText.replace(codeBlockRegex, '').trim();
  }

  return {
    code,
    explanation,
    raw
  };
}

module.exports = {
  sendPrompt,
  buildPrompt,
  parseResponse
};
