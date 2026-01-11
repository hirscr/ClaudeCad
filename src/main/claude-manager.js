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
 * @returns {Promise<string>} Claude's raw response text
 */
function sendPrompt(userMessage, currentCode = '', chatHistory = []) {
  return new Promise((resolve, reject) => {
    // Construct the full prompt
    const prompt = constructPrompt(userMessage, currentCode, chatHistory);

    console.log('[ClaudeManager] Sending prompt to Claude CLI...');
    console.log('[ClaudeManager] Prompt length:', prompt.length);

    // Spawn Claude CLI process
    // Using shell: true to properly handle command execution
    const process = spawn('claude', ['-p', prompt], {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

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
 * Construct the full prompt to send to Claude.
 * Includes system context, current code, chat history, and user message.
 *
 * @param {string} userMessage - The user's current request
 * @param {string} currentCode - The current Build123d code
 * @param {Array} chatHistory - Previous messages
 * @returns {string} The complete prompt
 */
function constructPrompt(userMessage, currentCode, chatHistory) {
  let prompt = '';

  // System context
  prompt += '# Role\n\n';
  prompt += 'You are a CAD assistant that generates Build123d Python code for 3D models.\n\n';

  // Build123d API reference (condensed)
  prompt += '# Build123d Quick Reference\n\n';
  prompt += '```python\n';
  prompt += 'from build123d import *\n\n';
  prompt += '# Basic shapes\n';
  prompt += 'with BuildPart() as part:\n';
  prompt += '    Box(width, depth, height)\n';
  prompt += '    Cylinder(radius, height)\n';
  prompt += '    Sphere(radius)\n\n';
  prompt += '# Holes\n';
  prompt += 'with Locations((x, y, z)):\n';
  prompt += '    Hole(radius=r, depth=d)\n\n';
  prompt += '# Fillets and chamfers\n';
  prompt += 'fillet(part.edges(), radius=r)\n';
  prompt += 'chamfer(part.edges(), length=l)\n\n';
  prompt += '# Shell (hollow)\n';
  prompt += 'shell(part.faces().sort_by(Axis.Z)[-1], thickness=t)\n';
  prompt += '```\n\n';

  // Current code context
  if (currentCode && currentCode.trim()) {
    prompt += '# Current Model Code\n\n';
    prompt += '```python\n';
    prompt += currentCode;
    prompt += '\n```\n\n';
  }

  // Chat history (summarize if too long)
  if (chatHistory && chatHistory.length > 0) {
    prompt += '# Conversation History\n\n';

    // If history is long (>10 messages), only include recent ones
    const recentHistory = chatHistory.length > 10
      ? chatHistory.slice(-10)
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
  prompt += '4. The code should be complete and executable\n\n';

  // User's current request
  prompt += '# User Request\n\n';
  prompt += userMessage;

  return prompt;
}

module.exports = {
  sendPrompt
};
