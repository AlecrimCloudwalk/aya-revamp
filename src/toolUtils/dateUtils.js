/**
 * Date and time formatting utilities for consistent display
 */

/**
 * Format a timestamp in a human-readable format
 * @param {number|string|Date} timestamp - Timestamp to format (Unix seconds, ISO string, or Date object)
 * @param {boolean} includeDate - Whether to include the date (default: false)
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(timestamp, includeDate = false) {
  let date;
  
  try {
    // Handle different timestamp formats
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      // Check if it's a Unix timestamp in seconds (Slack format) or milliseconds
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      if (timestamp.includes('T')) {
        // ISO format
        date = new Date(timestamp);
      } else {
        // Slack timestamp format (Unix seconds with decimal precision)
        try {
          const tsNum = parseFloat(timestamp);
          if (isNaN(tsNum)) {
            throw new Error('Invalid timestamp string');
          }
          date = new Date(tsNum * 1000);
        } catch (e) {
          throw new Error(`Invalid Slack timestamp: ${timestamp}`);
        }
      }
    } else {
      date = new Date();
    }
    
    // Validate the date is valid
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date: Time value is NaN');
    }
    
    // Get time components
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    
    // Format the time part
    const timeStr = `${hours12}:${minutes} ${ampm}`;
    
    // If we don't need the date, just return the time
    if (!includeDate) {
      return timeStr;
    }
    
    // Format the date part
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    // Create a copy of now to avoid modifying the original
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();
    
    if (isToday) {
      return `Today at ${timeStr}`;
    } else if (isYesterday) {
      return `Yesterday at ${timeStr}`;
    } else {
      // Format date based on current locale
      const month = date.toLocaleString('en-US', { month: 'short' });
      const day = date.getDate();
      return `${month} ${day} at ${timeStr}`;
    }
  } catch (error) {
    console.error(`Error formatting timestamp ${timestamp}: ${error.message}`);
    return 'unknown time';
  }
}

/**
 * Format relative time (e.g., "2 minutes ago")
 * @param {number|string|Date} timestamp - Timestamp to format
 * @returns {string} Relative time string
 */
function formatRelativeTime(timestamp) {
  try {
    let date;
    
    // Handle different timestamp formats
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      // Check if it's a Unix timestamp in seconds (Slack format) or milliseconds
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      if (timestamp.includes('T')) {
        // ISO format
        date = new Date(timestamp);
      } else {
        // Slack timestamp format (Unix seconds with decimal precision)
        const tsNum = parseFloat(timestamp);
        if (isNaN(tsNum)) {
          throw new Error('Invalid timestamp string');
        }
        date = new Date(tsNum * 1000);
      }
    } else {
      return 'recently'; // Default for invalid input
    }
    
    // Validate the date is valid
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date: Time value is NaN');
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    
    // Less than a minute
    if (diffSec < 60) {
      return 'just now';
    }
    
    // Less than an hour
    if (diffSec < 3600) {
      const minutes = Math.floor(diffSec / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    }
    
    // Less than a day
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    
    // Less than a week
    if (diffSec < 604800) {
      const days = Math.floor(diffSec / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
    
    // More than a week
    return formatTimestamp(date, true);
  } catch (error) {
    console.error(`Error calculating relative time for ${timestamp}: ${error.message}`);
    return 'recently';
  }
}

/**
 * Format a timestamp specifically for LLM context in DD/MM/YYYY HH:mm format
 * @param {number|string|Date} timestamp - Timestamp to format (Unix seconds, ISO string, or Date object)
 * @returns {string} Formatted timestamp string in DD/MM/YYYY HH:mm format
 */
function formatContextTimestamp(timestamp) {
  let date;
  
  try {
    // Handle different timestamp formats
    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      // Check if it's a Unix timestamp in seconds (Slack format) or milliseconds
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      if (timestamp.includes('T')) {
        // ISO format
        date = new Date(timestamp);
      } else {
        // Slack timestamp format (Unix seconds with decimal precision)
        try {
          const tsNum = parseFloat(timestamp);
          if (isNaN(tsNum)) {
            throw new Error('Invalid timestamp string');
          }
          date = new Date(tsNum * 1000);
        } catch (e) {
          throw new Error(`Invalid Slack timestamp: ${timestamp}`);
        }
      }
    } else {
      date = new Date();
    }
    
    // Validate the date is valid
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date: Time value is NaN');
    }
    
    // Format date as DD/MM/YYYY
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // +1 because months are 0-indexed
    const year = date.getFullYear();
    
    // Format time as HH:mm
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    // Return in format DD/MM/YYYY HH:mm
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch (error) {
    console.error(`Error formatting context timestamp ${timestamp}: ${error.message}`);
    return 'unknown time';
  }
}

module.exports = {
  formatTimestamp,
  formatRelativeTime,
  formatContextTimestamp
}; 