#!/usr/bin/env node

/**
 * debugLlm.js - Command line utility to enable detailed LLM debugging
 * 
 * This script sets up environment variables to enable comprehensive logging
 * of LLM interactions, making it easier to debug issues with the LLM.
 * 
 * Usage: node src/scripts/debugLlm.js
 * 
 * Options:
 *   --log-to-file: Log detailed LLM information to files in ./logs directory
 *   --verbose: Enable verbose logging for more details
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const logToFile = args.includes('--log-to-file');
const verbose = args.includes('--verbose');
const showRaw = args.includes('--show-raw');
const useAscii = args.includes('--ascii');

// Create logs directory if logging to file
if (logToFile) {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
    console.log(`Created logs directory at ${logsDir}`);
  }
}

// Set environment variables
const env = {
  ...process.env,
  DEBUG_LLM: 'true',
  DEBUG_CONTEXT: 'true',
  LOG_LEVEL: verbose ? 'VERBOSE' : 'NORMAL',
  SHOW_DETAILS: verbose ? 'true' : 'false',
  LLM_LOG_TO_FILE: logToFile ? 'true' : 'false',
  SHOW_RAW_MESSAGES: showRaw ? 'true' : 'false',
  FORCE_ASCII: useAscii ? 'true' : 'false',
};

// Banner
console.log('\n========================================');
console.log('🔍 LLM Debug Mode Enabled');
console.log('========================================');
console.log('✅ DEBUG_LLM: true');
console.log('✅ DEBUG_CONTEXT: true');
console.log(`✅ LOG_LEVEL: ${env.LOG_LEVEL}`);
console.log(`✅ SHOW_DETAILS: ${env.SHOW_DETAILS}`);
console.log(`✅ LOG_TO_FILE: ${logToFile}`);
console.log(`✅ SHOW_RAW_MESSAGES: ${showRaw}`);
console.log(`✅ FORCE_ASCII: ${useAscii}`);
console.log('========================================');
console.log('Starting application with LLM debugging...\n');

// Start the application with debug environment
const child = spawn('node', ['src/main.js'], { 
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32' // Use shell on Windows
});

// Handle process exit
child.on('close', (code) => {
  console.log(`\nApplication exited with code ${code}`);
});

// Handle errors
child.on('error', (err) => {
  console.error(`Failed to start application: ${err.message}`);
  process.exit(1);
}); 