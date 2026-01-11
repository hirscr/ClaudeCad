const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Manages a warm Python subprocess for executing Build123d code.
 * Keeps the Python process alive between requests to eliminate startup latency.
 */
class PythonManager {
  constructor() {
    this.process = null;
    this.isInitialized = false;
    this.pendingRequest = null;
    this.buffer = '';
  }

  /**
   * Initialize the Python subprocess.
   * Spawns the Python process and keeps it alive.
   */
  initialize() {
    return new Promise((resolve, reject) => {
      try {
        // Find Python executable in venv
        const projectRoot = path.join(__dirname, '..', '..');
        const pythonPath = path.join(projectRoot, 'venv', 'bin', 'python3');
        const scriptPath = path.join(projectRoot, 'src', 'python', 'cad_engine.py');

        // Verify Python exists
        if (!fs.existsSync(pythonPath)) {
          return reject(new Error(`Python not found at: ${pythonPath}`));
        }

        // Verify script exists
        if (!fs.existsSync(scriptPath)) {
          return reject(new Error(`CAD engine script not found at: ${scriptPath}`));
        }

        console.log('[PythonManager] Spawning Python process...');
        console.log('[PythonManager] Python:', pythonPath);
        console.log('[PythonManager] Script:', scriptPath);

        // Spawn Python process
        this.process = spawn(pythonPath, [scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: projectRoot
        });

        // Handle process errors
        this.process.on('error', (err) => {
          console.error('[PythonManager] Process error:', err);
          this.isInitialized = false;
          if (this.pendingRequest) {
            this.pendingRequest.reject(new Error(`Python process error: ${err.message}`));
            this.pendingRequest = null;
          }
        });

        // Handle process exit
        this.process.on('exit', (code, signal) => {
          console.log(`[PythonManager] Process exited with code ${code}, signal ${signal}`);
          this.isInitialized = false;
          if (this.pendingRequest) {
            this.pendingRequest.reject(new Error('Python process exited unexpectedly'));
            this.pendingRequest = null;
          }
        });

        // Handle stdout data
        this.process.stdout.on('data', (data) => {
          this.buffer += data.toString();

          // Check if we have a complete JSON response (ends with newline)
          if (this.buffer.includes('\n')) {
            const lines = this.buffer.split('\n');
            // Process all complete lines except the last (incomplete) one
            for (let i = 0; i < lines.length - 1; i++) {
              const line = lines[i].trim();
              if (line) {
                this.handleResponse(line);
              }
            }
            // Keep the incomplete line in the buffer
            this.buffer = lines[lines.length - 1];
          }
        });

        // Handle stderr output
        this.process.stderr.on('data', (data) => {
          console.error('[PythonManager] Python stderr:', data.toString());
        });

        this.isInitialized = true;
        console.log('[PythonManager] Python process initialized');
        resolve();
      } catch (err) {
        console.error('[PythonManager] Initialization error:', err);
        reject(err);
      }
    });
  }

  /**
   * Handle a JSON response from Python.
   */
  handleResponse(jsonStr) {
    if (!this.pendingRequest) {
      console.warn('[PythonManager] Received response with no pending request');
      return;
    }

    try {
      const response = JSON.parse(jsonStr);
      console.log('[PythonManager] Received response:', response);

      // Clear timeout
      if (this.pendingRequest.timeout) {
        clearTimeout(this.pendingRequest.timeout);
      }

      // Resolve the pending promise
      this.pendingRequest.resolve(response);
      this.pendingRequest = null;
    } catch (err) {
      console.error('[PythonManager] Failed to parse response:', jsonStr);
      this.pendingRequest.reject(new Error('Invalid JSON response from Python'));
      this.pendingRequest = null;
    }
  }

  /**
   * Execute Build123d code in the Python subprocess.
   * @param {string} code - The Build123d Python code to execute
   * @returns {Promise<Object>} Response object with success, mesh_path, or error
   */
  execute(code) {
    return new Promise(async (resolve, reject) => {
      // Check if initialized
      if (!this.isInitialized || !this.process) {
        console.log('[PythonManager] Not initialized, attempting to initialize...');
        try {
          await this.initialize();
        } catch (err) {
          return reject(new Error(`Failed to initialize Python: ${err.message}`));
        }
      }

      // Check if there's already a pending request
      if (this.pendingRequest) {
        return reject(new Error('Another request is already in progress'));
      }

      console.log('[PythonManager] Executing code...');

      // Store the pending request
      this.pendingRequest = { resolve, reject };

      // Set timeout (10 seconds)
      this.pendingRequest.timeout = setTimeout(() => {
        console.error('[PythonManager] Execution timeout');
        if (this.pendingRequest) {
          this.pendingRequest.reject(new Error('Python execution timed out (10s)'));
          this.pendingRequest = null;
        }

        // Kill and restart the process
        if (this.process) {
          this.process.kill();
          this.isInitialized = false;
        }
      }, 10000);

      // Send code to Python via stdin
      try {
        this.process.stdin.write(code);
        this.process.stdin.write('\n__END__\n'); // Delimiter to signal end of code
        this.process.stdin.end(); // Close stdin to signal we're done

        // After ending stdin, the process will exit, so we need to reinitialize for next request
        this.isInitialized = false;
      } catch (err) {
        clearTimeout(this.pendingRequest.timeout);
        this.pendingRequest = null;
        reject(new Error(`Failed to send code to Python: ${err.message}`));
      }
    });
  }

  /**
   * Shutdown the Python subprocess.
   */
  shutdown() {
    if (this.process) {
      console.log('[PythonManager] Shutting down Python process...');
      this.process.kill();
      this.process = null;
      this.isInitialized = false;
    }
  }
}

module.exports = new PythonManager();
