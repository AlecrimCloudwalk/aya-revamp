/**
 * Script to help developers replace console.log with the new logger utility
 * 
 * Usage:
 * 1. node scripts/update-to-logger.js path/to/file.js
 * 2. Review the generated output file for changes
 * 3. Replace original file with updated version if satisfied
 */

const fs = require('fs');
const path = require('path');

// Check arguments
const filePath = process.argv[2];
if (!filePath) {
  console.error('Error: Please provide a file path');
  console.error('Usage: node scripts/update-to-logger.js path/to/file.js');
  process.exit(1);
}

// Verify file exists
if (!fs.existsSync(filePath)) {
  console.error(`Error: File ${filePath} does not exist`);
  process.exit(1);
}

// Read file content
let content = fs.readFileSync(filePath, 'utf8');

// First make sure logger is properly imported
if (!content.includes('require(\'../toolUtils/logger\')') && 
    !content.includes('require("../toolUtils/logger")') &&
    !content.includes('require(\'./logger\')') &&
    !content.includes('require("./logger")')) {
  
  // Determine the right import path based on file location
  const relativePath = path.relative(path.dirname(filePath), 'src/toolUtils/logger.js');
  const importPath = relativePath.startsWith('.') 
    ? relativePath 
    : `./${relativePath}`;
  
  // Find a good spot to add the import
  const lastImport = content.match(/const .* = require\(['"][^'"]+['"]\);?/g);
  if (lastImport && lastImport.length > 0) {
    const lastImportMatch = lastImport[lastImport.length - 1];
    const importPos = content.indexOf(lastImportMatch) + lastImportMatch.length;
    
    // Add logger import after the last import
    content = content.slice(0, importPos) + 
              '\nconst logger = require(\'' + importPath.replace(/\\/g, '/') + '\');\n' + 
              content.slice(importPos);
    
    console.log('✅ Added logger import');
  } else {
    console.log('⚠️ Could not find a good spot for logger import. Please add it manually.');
  }
}

// Replace console.log, console.warn, console.error statements
const replacements = [
  {
    pattern: /console\.log\((['"`])([^'"`]+)(['"`])(?:,\s*(.*))?\);/g,
    getReplacer: (match, q1, message, q3, data) => {
      // Determine the log level based on content
      let logLevel = 'info';
      const lowerMsg = message.toLowerCase();
      
      if (lowerMsg.includes('error') || lowerMsg.includes('❌') || lowerMsg.includes('⚠️')) {
        logLevel = 'warn';
      } else if (lowerMsg.includes('debug') || lowerMsg.includes('🔍')) {
        logLevel = 'debug';
      } else if (lowerMsg.includes('detail') || lowerMsg.startsWith('🔄')) {
        logLevel = 'detail';
      }
      
      // If there's additional data, add it as a second parameter
      if (data) {
        return `logger.${logLevel}(${q1}${message}${q3}, ${data});`;
      } else {
        return `logger.${logLevel}(${q1}${message}${q3});`;
      }
    }
  },
  {
    pattern: /console\.warn\((['"`])([^'"`]+)(['"`])(?:,\s*(.*))?\);/g,
    getReplacer: (match, q1, message, q3, data) => {
      if (data) {
        return `logger.warn(${q1}${message}${q3}, ${data});`;
      } else {
        return `logger.warn(${q1}${message}${q3});`;
      }
    }
  },
  {
    pattern: /console\.error\((['"`])([^'"`]+)(['"`])(?:,\s*(.*))?\);/g,
    getReplacer: (match, q1, message, q3, data) => {
      if (data) {
        return `logger.error(${q1}${message}${q3}, ${data});`;
      } else {
        return `logger.error(${q1}${message}${q3});`;
      }
    }
  },
  // Handle console.log with JSON.stringify
  {
    pattern: /console\.log\((['"`])([^'"`]+)(['"`]),\s*JSON\.stringify\((.*),\s*null,\s*2\)\);/g,
    getReplacer: (match, q1, message, q3, obj) => {
      return `logger.detail(${q1}${message}${q3}, ${obj});`;
    }
  },
  // Handle console.log + console.log(JSON.stringify()) pattern
  {
    pattern: /console\.log\((['"`])([^'"`]+)(['"`])\);\s*console\.log\(JSON\.stringify\((.*),\s*null,\s*2\)\);/g,
    getReplacer: (match, q1, message, q3, obj) => {
      return `logger.detail(${q1}${message}${q3}, ${obj});`;
    }
  }
];

// Apply replacements
let changedCount = 0;
for (const replacement of replacements) {
  const originalContent = content;
  content = content.replace(replacement.pattern, replacement.getReplacer);
  
  if (originalContent !== content) {
    changedCount++;
  }
}

// Write the updated content to a new file with .updated extension
const outputFile = `${filePath}.updated`;
fs.writeFileSync(outputFile, content, 'utf8');

console.log(`✅ Updated ${changedCount} log statements in ${filePath}`);
console.log(`✅ Saved to ${outputFile}`);
console.log('Please review the changes and replace the original file if satisfied.');
console.log('\nTo replace the original file:');
console.log(`cp ${outputFile} ${filePath}`); 