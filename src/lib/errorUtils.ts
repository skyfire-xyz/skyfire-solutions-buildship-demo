/**
 * Utility functions for enhanced error logging and handling
 */

export interface ErrorDetails {
  error: unknown;
  message: string;
  stack?: string;
  fullError: string;
  timestamp: string;
  operation?: string;
  context?: Record<string, any>;
}

/**
 * Creates detailed error information for logging
 * @param error - The error object
 * @param operation - Optional operation name for context
 * @param context - Optional additional context information
 * @returns Detailed error information
 */
export function createErrorDetails(
  error: unknown, 
  operation?: string, 
  context?: Record<string, any>
): ErrorDetails {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const fullError = JSON.stringify(error, Object.getOwnPropertyNames(error), 2);
  
  return {
    error,
    message,
    stack,
    fullError,
    timestamp: new Date().toISOString(),
    operation,
    context
  };
}

/**
 * Logs an error with enhanced details
 * @param message - Log message prefix
 * @param error - The error object
 * @param operation - Optional operation name for context
 * @param context - Optional additional context information
 */
export function logError(
  message: string,
  error: unknown,
  operation?: string,
  context?: Record<string, any>
): void {
  const errorDetails = createErrorDetails(error, operation, context);
  console.error(message, errorDetails);
}

/**
 * Logs an HTTP error with enhanced details
 * @param message - Log message prefix
 * @param response - HTTP response object
 * @param requestDetails - Request details (url, method, headers, body)
 * @param errorData - Optional error data from response
 */
export function logHttpError(
  message: string,
  response: Response,
  requestDetails?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
  errorData?: any
): void {
  const errorDetails = {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    errorMessage: errorData?.error || response.statusText,
    fullErrorData: errorData,
    requestDetails,
    timestamp: new Date().toISOString()
  };
  
  console.error(message, errorDetails);
}

/**
 * Safely stringifies an object, handling circular references
 * @param obj - Object to stringify
 * @returns JSON string or error message
 */
export function safeStringify(obj: any): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (error) {
    return `[Error stringifying object: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Extracts error message from various error types
 * @param error - Error object
 * @returns Human-readable error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  if (typeof error === 'object' && error !== null) {
    // Try to extract message from common error object patterns
    const errorObj = error as any;
    if (errorObj.message) return errorObj.message;
    if (errorObj.error) return errorObj.error;
    if (errorObj.reason) return errorObj.reason;
  }
  
  return String(error) || 'Unknown error occurred';
}
